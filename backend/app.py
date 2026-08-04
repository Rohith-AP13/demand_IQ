"""
Demand Forecasting & Inventory Management - Flask REST API
Based on XGBoost demand forecasting + Q-Learning RL inventory optimization
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import numpy as np
import joblib
import os
import random
import math
import warnings
warnings.filterwarnings("ignore")

app = Flask(__name__)
CORS(app)

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))   # backend/
MODEL_PATH     = os.path.join(BASE_DIR, "models", "xgboost_walmart.pkl")
INVENTORY_PATH = os.path.join(BASE_DIR, "data",   "inventory.csv")
SUPPLIER_PATH  = os.path.join(BASE_DIR, "data",   "supplier.csv")
# processed_features.csv is large (113MB); kept in backend/data if present
FEATURES_PATH  = os.path.join(BASE_DIR, "data",   "processed_features.csv")

# ─── Load Assets ──────────────────────────────────────────────────────────────
print("Loading model and data...")
model     = joblib.load(MODEL_PATH)
inventory = pd.read_csv(INVENTORY_PATH)
supplier  = pd.read_csv(SUPPLIER_PATH)

# processed_features.csv is optional (113MB) — used only for computing feature means
if os.path.exists(FEATURES_PATH):
    features = pd.read_csv(FEATURES_PATH, nrows=5000)
    print("[OK] Features file loaded")
else:
    # Build a minimal synthetic features DataFrame from model feature names
    # so the API can still compute default mean values for predictions
    print("[WARN] processed_features.csv not found — using synthetic feature defaults")
    _default_vals = {
        'Store': 20, 'Dept': 10, 'IsHoliday': 0, 'Temperature': 60.0,
        'Fuel_Price': 3.5, 'MarkDown1': 0, 'MarkDown2': 0, 'MarkDown3': 0,
        'MarkDown4': 0, 'MarkDown5': 0, 'CPI': 211.0, 'Unemployment': 8.0,
        'Type': 1, 'Size': 150000, 'Year': 2011, 'Month': 6, 'Week': 26,
        'Day': 15, 'Quarter': 2, 'DayOfWeek': 4, 'Promotion': 0,
        'Total_MarkDown': 0, 'Lag_1': 15000, 'Lag_2': 14500, 'Lag_4': 14000,
        'Rolling_Mean_4': 14500, 'Rolling_Mean_8': 14200, 'Rolling_STD_4': 800,
        'Expanding_Mean': 14000, 'Store_Avg_Sales': 15000, 'Dept_Avg_Sales': 12000,
        'StoreDept_Avg': 13000, 'StoreSize_Temp': 9000000, 'Holiday_Promotion': 0,
        'Month_Sin': 0.5, 'Month_Cos': 0.866, 'Week_Sin': 0.568, 'Week_Cos': 0.823,
    }
    features = pd.DataFrame([_default_vals] * 100)

print(f"[OK] Model loaded | {len(model.feature_names_in_)} features")
print(f"[OK] Inventory: {len(inventory)} records | Suppliers: {len(supplier)}")

FEATURE_COLS = list(model.feature_names_in_)

# ─── Supplier Scoring ─────────────────────────────────────────────────────────
supplier["Supplier_Score"] = (
    0.5 * supplier["Reliability"]
    - 0.3 * supplier["Cost_Per_Unit"]
    - 0.2 * supplier["Delivery_Time"]
)
supplier = supplier.sort_values("Supplier_Score", ascending=False).reset_index(drop=True)


# ─── RL Q-Learning Inventory Optimizer ───────────────────────────────────────
def rl_optimize(predicted_demand, current_stock, holding_cost, ordering_cost, episodes=500):
    """Q-Learning based inventory order quantity optimizer."""
    actions      = [0, 200, 400, 600, 800, 1000]
    num_actions  = len(actions)
    max_stock    = 5000
    alpha        = 0.1
    gamma        = 0.95
    epsilon      = 0.2

    Q = np.zeros((max_stock + 1, num_actions))

    for episode in range(episodes):
        stock = int(min(current_stock, max_stock))
        done  = False
        step  = 0

        while not done and step < 52:
            state = int(min(stock, max_stock))

            if random.random() < epsilon:
                action_idx = random.randint(0, num_actions - 1)
            else:
                action_idx = int(np.argmax(Q[state]))

            order_qty  = actions[action_idx]
            stock      = stock + order_qty
            demand_met = min(stock, predicted_demand)
            stock      = max(0, stock - demand_met)

            reward = (
                - holding_cost * stock
                - (ordering_cost if order_qty > 0 else 0)
                + demand_met * 10
            )

            next_state = int(min(stock, max_stock))

            Q[state, action_idx] += alpha * (
                reward + gamma * np.max(Q[next_state]) - Q[state, action_idx]
            )

            if stock <= 0 or step >= 51:
                done = True
            step += 1

    state       = int(min(current_stock, max_stock))
    best_action = int(np.argmax(Q[state]))
    order_qty   = actions[best_action]
    return order_qty, best_action, Q[state].tolist()


# ─── EOQ / ROP / Safety Stock ────────────────────────────────────────────────
def calculate_inventory_metrics(predicted_demand, current_stock, lead_time, ordering_cost, holding_cost):
    z            = 1.65  # 95% service level
    daily_demand = predicted_demand / 7
    sigma        = daily_demand * 0.25
    safety_stock = z * sigma * math.sqrt(lead_time)
    rop          = (daily_demand * lead_time) + safety_stock
    annual_demand = predicted_demand * 52
    eoq = math.sqrt((2 * annual_demand * ordering_cost) / holding_cost) if holding_cost > 0 else 0
    needs_reorder = current_stock <= rop
    return {
        "safety_stock"  : round(safety_stock, 2),
        "reorder_point" : round(rop, 2),
        "eoq"           : round(eoq, 2),
        "needs_reorder" : needs_reorder,
        "days_of_stock" : round(current_stock / daily_demand, 1) if daily_demand > 0 else 999,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": "XGBoost + Q-Learning RL", "features": len(FEATURE_COLS)})


# ─── Demand Forecast ──────────────────────────────────────────────────────────
@app.route("/api/forecast", methods=["POST"])
def forecast():
    """
    Predict weekly sales using XGBoost.
    Accepts partial input; missing features filled from dataset mean.
    """
    data = request.json or {}

    # Build input row from means, override with user values
    sample = features[FEATURE_COLS].mean().to_dict()

    # Map user-friendly fields
    field_map = {
        "store"        : "Store",
        "dept"         : "Dept",
        "is_holiday"   : "IsHoliday",
        "temperature"  : "Temperature",
        "fuel_price"   : "Fuel_Price",
        "cpi"          : "CPI",
        "unemployment" : "Unemployment",
        "week"         : "Week",
        "month"        : "Month",
        "year"         : "Year",
        "promotion"    : "Promotion",
        "markdown1"    : "MarkDown1",
        "markdown2"    : "MarkDown2",
        "markdown3"    : "MarkDown3",
        "markdown4"    : "MarkDown4",
        "markdown5"    : "MarkDown5",
    }

    for user_key, feat_key in field_map.items():
        if user_key in data and feat_key in sample:
            sample[feat_key] = float(data[user_key])

    # Recompute derived fields
    m1 = sample.get("MarkDown1", 0)
    m2 = sample.get("MarkDown2", 0)
    m3 = sample.get("MarkDown3", 0)
    m4 = sample.get("MarkDown4", 0)
    m5 = sample.get("MarkDown5", 0)
    sample["Total_MarkDown"] = m1 + m2 + m3 + m4 + m5
    sample["Promotion"] = 1 if sample["Total_MarkDown"] > 0 else sample.get("Promotion", 0)
    month = int(sample.get("Month", 1))
    week  = int(sample.get("Week", 1))
    sample["Month_Sin"] = math.sin(2 * math.pi * month / 12)
    sample["Month_Cos"] = math.cos(2 * math.pi * month / 12)
    sample["Week_Sin"]  = math.sin(2 * math.pi * week / 52)
    sample["Week_Cos"]  = math.cos(2 * math.pi * week / 52)
    sample["Holiday_Promotion"] = sample.get("IsHoliday", 0) * sample.get("Promotion", 0)
    sample["StoreSize_Temp"] = sample.get("Size", sample.get("Size", 150000)) * sample.get("Temperature", 60)

    input_df    = pd.DataFrame([sample])[FEATURE_COLS]
    prediction  = float(model.predict(input_df)[0])
    # Prediction confidence band (±10%)
    lower = round(prediction * 0.90, 2)
    upper = round(prediction * 1.10, 2)

    return jsonify({
        "store"           : int(sample.get("Store", 1)),
        "dept"            : int(sample.get("Dept", 1)),
        "week"            : int(sample.get("Week", 1)),
        "is_holiday"      : bool(sample.get("IsHoliday", 0)),
        "promotion"       : bool(sample.get("Promotion", 0)),
        "predicted_sales" : round(prediction, 2),
        "lower_bound"     : lower,
        "upper_bound"     : upper,
        "model"           : "XGBoost (n_estimators=300)",
    })


# ─── Inventory Optimize (RL) ──────────────────────────────────────────────────
@app.route("/api/inventory/optimize", methods=["POST"])
def inventory_optimize():
    data = request.json or {}
    store = int(data.get("store", 1))
    dept  = int(data.get("dept",  1))

    product = inventory[(inventory["Store"] == store) & (inventory["Dept"] == dept)]
    if product.empty:
        return jsonify({"error": f"No inventory record for Store={store}, Dept={dept}"}), 404

    row            = product.iloc[0]
    current_stock  = int(row["Current_Stock"])
    lead_time      = int(row["Lead_Time"])
    ordering_cost  = float(row["Ordering_Cost"])
    holding_cost   = float(row["Holding_Cost"])
    supplier_id    = row["Supplier_ID"]

    # Get demand prediction first
    sample = features[FEATURE_COLS].mean().to_dict()
    sample["Store"] = store
    sample["Dept"]  = dept
    input_df = pd.DataFrame([sample])[FEATURE_COLS]
    predicted_demand = float(model.predict(input_df)[0])

    # RL optimization
    order_qty, best_action, q_values = rl_optimize(
        predicted_demand, current_stock, holding_cost, ordering_cost
    )

    # EOQ metrics
    metrics = calculate_inventory_metrics(
        predicted_demand, current_stock, lead_time, ordering_cost, holding_cost
    )

    # Supplier info
    sup_row = supplier[supplier["Supplier_ID"] == supplier_id]
    sup_info = sup_row.iloc[0].to_dict() if not sup_row.empty else {}

    return jsonify({
        "store"            : store,
        "dept"             : dept,
        "predicted_demand" : round(predicted_demand, 2),
        "current_stock"    : current_stock,
        "lead_time"        : lead_time,
        "ordering_cost"    : ordering_cost,
        "holding_cost"     : holding_cost,
        "rl_order_qty"     : order_qty,
        "rl_best_action"   : best_action,
        "rl_q_values"      : [round(v, 4) for v in q_values],
        "order_quantities" : [0, 200, 400, 600, 800, 1000],
        "supplier"         : sup_info,
        **metrics,
    })


# ─── Inventory Status Table ───────────────────────────────────────────────────
@app.route("/api/inventory/status", methods=["GET"])
def inventory_status():
    store_filter = request.args.get("store", type=int)
    limit = request.args.get("limit", 50, type=int)

    inv = inventory.copy()
    if store_filter:
        inv = inv[inv["Store"] == store_filter]

    inv = inv.head(limit)

    # Attach quick demand estimates and reorder flags
    results = []
    feature_means = features[FEATURE_COLS].mean().to_dict()

    for _, row in inv.iterrows():
        sample = feature_means.copy()
        sample["Store"] = row["Store"]
        sample["Dept"]  = row["Dept"]
        input_df = pd.DataFrame([sample])[FEATURE_COLS]
        pred_demand = float(model.predict(input_df)[0])

        metrics = calculate_inventory_metrics(
            pred_demand,
            int(row["Current_Stock"]),
            int(row["Lead_Time"]),
            float(row["Ordering_Cost"]),
            float(row["Holding_Cost"]),
        )

        stock_ratio = int(row["Current_Stock"]) / max(pred_demand, 1)
        if metrics["needs_reorder"]:
            status = "CRITICAL" if int(row["Current_Stock"]) < metrics["reorder_point"] * 0.5 else "LOW"
        else:
            status = "OK" if stock_ratio < 3 else "EXCESS"

        results.append({
            "store"           : int(row["Store"]),
            "dept"            : int(row["Dept"]),
            "current_stock"   : int(row["Current_Stock"]),
            "lead_time"       : int(row["Lead_Time"]),
            "ordering_cost"   : float(row["Ordering_Cost"]),
            "holding_cost"    : float(row["Holding_Cost"]),
            "supplier_id"     : row["Supplier_ID"],
            "predicted_demand": round(pred_demand, 2),
            "status"          : status,
            **metrics,
        })

    return jsonify({"count": len(results), "items": results})


# ─── EOQ Calculation ──────────────────────────────────────────────────────────
@app.route("/api/inventory/eoq", methods=["POST"])
def eoq_calc():
    data = request.json or {}
    result = calculate_inventory_metrics(
        predicted_demand = float(data.get("predicted_demand", 500)),
        current_stock    = int(data.get("current_stock", 300)),
        lead_time        = int(data.get("lead_time", 5)),
        ordering_cost    = float(data.get("ordering_cost", 200)),
        holding_cost     = float(data.get("holding_cost", 10)),
    )
    return jsonify(result)


# ─── Suppliers ────────────────────────────────────────────────────────────────
@app.route("/api/suppliers", methods=["GET"])
def get_suppliers():
    sup = supplier.copy()
    records = []
    for _, row in sup.iterrows():
        count = len(inventory[inventory["Supplier_ID"] == row["Supplier_ID"]])
        records.append({
            "supplier_id"   : row["Supplier_ID"],
            "supplier_name" : row["Supplier_Name"],
            "cost_per_unit" : float(row["Cost_Per_Unit"]),
            "delivery_time" : int(row["Delivery_Time"]),
            "reliability"   : float(row["Reliability"]),
            "score"         : round(float(row["Supplier_Score"]), 4),
            "products_count": count,
        })
    return jsonify({"suppliers": records})


# ─── Dashboard Summary ────────────────────────────────────────────────────────
@app.route("/api/dashboard/summary", methods=["GET"])
def dashboard_summary():
    total_products = len(inventory)
    stores         = inventory["Store"].nunique()
    depts          = inventory["Dept"].nunique()
    avg_stock      = round(float(inventory["Current_Stock"].mean()), 1)

    # Quick status counts from a sample
    sample_inv = inventory.head(100)
    critical = low = ok = excess = 0
    total_demand = 0
    feature_means = features[FEATURE_COLS].mean().to_dict()

    preds = []
    for _, row in sample_inv.iterrows():
        s = feature_means.copy()
        s["Store"] = row["Store"]
        s["Dept"]  = row["Dept"]
        df = pd.DataFrame([s])[FEATURE_COLS]
        p = float(model.predict(df)[0])
        preds.append(p)
        metrics = calculate_inventory_metrics(p, int(row["Current_Stock"]),
                    int(row["Lead_Time"]), float(row["Ordering_Cost"]), float(row["Holding_Cost"]))
        if metrics["needs_reorder"] and int(row["Current_Stock"]) < metrics["reorder_point"] * 0.5:
            critical += 1
        elif metrics["needs_reorder"]:
            low += 1
        elif int(row["Current_Stock"]) / max(p, 1) >= 3:
            excess += 1
        else:
            ok += 1
        total_demand += p

    avg_demand = round(total_demand / len(sample_inv), 2)

    # Weekly sales trend (simulated from features)
    weekly = features.groupby("Week")["Lag_1"].mean().reset_index()
    weekly.columns = ["week", "avg_sales"]
    trend = weekly.head(20).to_dict(orient="records")

    # Store performance
    store_perf = features.groupby("Store")["Lag_1"].mean().reset_index()
    store_perf.columns = ["store", "avg_sales"]
    store_perf = store_perf.sort_values("avg_sales", ascending=False).head(10)
    top_stores = store_perf.to_dict(orient="records")

    # Dept performance
    dept_perf = features.groupby("Dept")["Lag_1"].mean().reset_index()
    dept_perf.columns = ["dept", "avg_sales"]
    dept_perf = dept_perf.sort_values("avg_sales", ascending=False).head(10)
    top_depts = dept_perf.to_dict(orient="records")

    return jsonify({
        "kpis": {
            "total_products"  : total_products,
            "total_stores"    : int(stores),
            "total_depts"     : int(depts),
            "avg_stock"       : avg_stock,
            "avg_weekly_demand": avg_demand,
            "critical_items"  : critical,
            "low_items"       : low,
            "ok_items"        : ok,
            "excess_items"    : excess,
            "total_suppliers" : len(supplier),
        },
        "weekly_trend"  : trend,
        "top_stores"    : top_stores,
        "top_depts"     : top_depts,
    })


# ─── Stores & Depts ───────────────────────────────────────────────────────────
@app.route("/api/stores", methods=["GET"])
def get_stores():
    stores = sorted(inventory["Store"].unique().tolist())
    depts  = sorted(inventory["Dept"].unique().tolist())
    return jsonify({"stores": stores, "depts": depts})


# ─── Feature Importance ───────────────────────────────────────────────────────
@app.route("/api/model/importance", methods=["GET"])
def feature_importance():
    importance = pd.DataFrame({
        "feature"   : FEATURE_COLS,
        "importance": model.feature_importances_,
    }).sort_values("importance", ascending=False)
    return jsonify(importance.head(15).to_dict(orient="records"))


if __name__ == "__main__":
    print("\n[OK] Starting Demand Forecasting API on http://localhost:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
