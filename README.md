# DemandIQ — AI Demand Forecasting & Inventory Management

A full-stack web application built from Walmart sales data notebooks using:
- **XGBoost** for weekly demand forecasting (38 features, 356K training rows)
- **Q-Learning RL** for inventory order optimization
- **EOQ / ROP / Safety Stock** calculations
- **Flask** REST API backend + Premium dark-theme frontend

---

## Project Structure

```
DemandIQ/
├── START_APP.bat            ← Double-click to launch the entire app
├── README.md
│
├── backend/
│   ├── app.py               ← Flask REST API (8 endpoints)
│   ├── requirements.txt     ← Python dependencies
│   ├── models/
│   │   └── xgboost_walmart.pkl   ← Trained XGBoost model
│   └── data/
│       ├── inventory.csv         ← 3,331 store-dept records
│       ├── supplier.csv          ← 5 suppliers with metadata
│       └── processed_features.csv  ← (Optional, 113MB) Feature matrix
│
├── frontend/
│   ├── index.html           ← Single Page App entry point
│   ├── css/
│   │   └── style.css        ← Premium dark UI styles
│   └── js/
│       └── app.js           ← App logic + Chart.js visualizations
│
└── notebooks/
    ├── demand_forecasting.ipynb         ← XGBoost model training
    └── rl_inventory_optimization.ipynb  ← Q-Learning RL agent
```

---

## Quick Start

### Step 1 — Install Python dependencies
```bash
cd backend
pip install -r requirements.txt
```

### Step 2 — Launch the app
**Option A:** Double-click `START_APP.bat`

**Option B:** Manual
```bash
# Terminal 1 — start backend
python backend/app.py

# Then open in your browser:
frontend/index.html
```

### Step 3 — Open frontend
Open `frontend/index.html` in any modern browser.
Make sure the backend is running on `http://localhost:5000` first.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/stores` | List all stores & departments |
| POST | `/api/forecast` | XGBoost demand prediction |
| GET | `/api/inventory/status` | All products with stock status |
| POST | `/api/inventory/optimize` | Q-Learning RL order recommendation |
| POST | `/api/inventory/eoq` | EOQ / ROP / Safety Stock |
| GET | `/api/suppliers` | Ranked supplier list |
| GET | `/api/dashboard/summary` | KPIs + chart data |

### Example — Demand Forecast Request
```bash
curl -X POST http://localhost:5000/api/forecast \
  -H "Content-Type: application/json" \
  -d '{"store": 1, "dept": 1, "week": 26, "month": 6, "temperature": 65, "is_holiday": 0}'
```

### Example Response
```json
{
  "store": 1, "dept": 1, "week": 26,
  "predicted_sales": 7196.25,
  "lower_bound": 6476.62,
  "upper_bound": 7915.88,
  "model": "XGBoost (n_estimators=300)"
}
```

---

## Frontend Pages

| Page | Description |
|------|-------------|
| **Dashboard** | KPI cards, weekly sales trend, inventory status donut, top stores/depts charts |
| **Demand Forecast** | Input form for any store/dept/week, real-time XGBoost prediction with confidence range |
| **Inventory Manager** | Searchable table with Critical/Low/OK/Excess status badges, EOQ, ROP, days-of-stock |
| **RL Optimizer** | Q-Learning agent recommendation per product, Q-values bar chart, supplier info |
| **Supplier Analytics** | Ranked supplier cards with reliability, cost, delivery time scores |

---

## Model Details

| Item | Detail |
|------|--------|
| Algorithm | XGBoost Regressor |
| n_estimators | 300 |
| learning_rate | 0.05 |
| max_depth | 8 |
| Features | 38 (lags, rolling stats, markdowns, CPI, temperature, etc.) |
| RL Algorithm | Q-Learning (tabular) |
| RL Episodes | 800 per request |
| RL Actions | 0, 200, 400, 600, 800, 1000 units |
| Supplier Score | `0.5×Reliability - 0.3×Cost - 0.2×DeliveryTime` |

---

## Requirements

- Python 3.9+
- Modern browser (Chrome, Firefox, Edge)
- See `backend/requirements.txt` for Python packages
"# demand_IQ" 
