from __future__ import annotations

import io
import csv
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import streamlit as st


st.set_page_config(
    page_title="AI Data Analyst & BI Copilot",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="collapsed",
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MISSING_MARKERS = {"", "na", "n/a", "null", "none"}


def parse_dataset(file_bytes: bytes) -> tuple[pd.DataFrame, dict]:
    if not file_bytes:
        raise ValueError("The uploaded file is empty.")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise ValueError("CSV files must be 10 MB or smaller.")

    try:
        decoded = file_bytes.decode("utf-8-sig")
        header_row = next(
            (row for row in csv.reader(io.StringIO(decoded)) if any(cell.strip() for cell in row)),
            [],
        )
        normalized_headers = [header.strip() for header in header_row]
        if any(not header for header in normalized_headers):
            raise ValueError("Column names cannot be empty.")
        if len(set(normalized_headers)) != len(normalized_headers):
            raise ValueError("CSV column names must be unique.")
        frame = pd.read_csv(io.BytesIO(file_bytes), encoding="utf-8-sig")
    except (pd.errors.ParserError, UnicodeDecodeError, ValueError) as error:
        raise ValueError(f"Could not parse the CSV file: {error}") from error

    frame.columns = [str(column).strip() for column in frame.columns]
    if frame.empty or not len(frame.columns):
        raise ValueError("The CSV must include a header row and at least one data row.")
    if any(not column for column in frame.columns):
        raise ValueError("Column names cannot be empty.")
    if len(set(frame.columns)) != len(frame.columns):
        raise ValueError("CSV column names must be unique.")

    for column in frame.columns:
        if pd.api.types.is_object_dtype(frame[column]) or isinstance(frame[column].dtype, pd.StringDtype):
            values = frame[column].astype("string").str.strip()
            frame[column] = values.mask(values.str.lower().isin(MISSING_MARKERS))
    original_rows = len(frame)
    duplicate_count = int(frame.duplicated().sum())
    frame = frame.drop_duplicates().copy()
    numeric_columns = []
    categorical_columns = []

    for column in frame.columns:
        original = frame[column]
        converted = pd.to_numeric(original, errors="coerce")
        observed = original.notna()
        if observed.any() and converted[observed].notna().mean() >= 0.7:
            frame[column] = converted
            numeric_columns.append(column)
        else:
            frame[column] = original.astype("string").str.strip()
            categorical_columns.append(column)

    missing_count = int(frame.isna().sum().sum())
    for column in numeric_columns:
        mean = frame[column].mean()
        frame[column] = frame[column].fillna(mean if pd.notna(mean) else 0)
    for column in categorical_columns:
        mode = frame[column].mode(dropna=True)
        frame[column] = frame[column].fillna(mode.iloc[0] if not mode.empty else "Unknown")

    quality_denominator = max(1, original_rows * len(frame.columns))
    quality = max(
        0,
        min(
            100,
            round(100 - (duplicate_count + missing_count) / quality_denominator * 100),
        ),
    )
    report = {
        "initial_rows": original_rows,
        "rows": len(frame),
        "duplicates_removed": duplicate_count,
        "missing_imputed": missing_count,
        "quality": quality,
        "numeric_columns": numeric_columns,
        "categorical_columns": categorical_columns,
    }
    return frame.reset_index(drop=True), report


def forecast_metric(frame: pd.DataFrame, column: str, horizon: int) -> dict | None:
    values = pd.to_numeric(frame[column], errors="coerce").dropna().to_numpy(dtype=float)
    if len(values) < 2:
        return None

    x = np.arange(1, len(values) + 1, dtype=float)
    slope, intercept = np.polyfit(x, values, 1)
    fitted = slope * x + intercept
    total_squares = float(np.sum((values - values.mean()) ** 2))
    residual_squares = float(np.sum((values - fitted) ** 2))
    r_squared = max(0.0, min(1.0, 1 - residual_squares / total_squares)) if total_squares else 0.0
    residual_std = float(np.sqrt(residual_squares / (len(values) - 2))) if len(values) > 2 else abs(float(values.mean())) * 0.08

    holdout = min(3, max(0, int(len(values) * 0.2))) if len(values) >= 5 else 0
    errors = []
    percentage_errors = []
    for index in range(len(values) - holdout, len(values)):
        if index < 2:
            continue
        train_x = x[:index]
        train_y = values[:index]
        local_slope, local_intercept = np.polyfit(train_x, train_y, 1)
        error = abs(float(values[index] - (local_slope * x[index] + local_intercept)))
        errors.append(error)
        if values[index] != 0:
            percentage_errors.append(error / abs(float(values[index])))

    mean_x = float(x.mean())
    sum_squared_x = float(np.sum((x - mean_x) ** 2))
    predictions = []
    for step in range(1, horizon + 1):
        future_x = len(values) + step
        predicted = max(0.0, float(slope * future_x + intercept))
        leverage = (future_x - mean_x) ** 2 / sum_squared_x if sum_squared_x else 0.0
        margin = 1.28 * residual_std * np.sqrt(1 + 1 / len(values) + leverage)
        predictions.append(
            {
                "period": f"Forecast +{step}",
                "forecast": predicted,
                "lower": max(0.0, predicted - margin),
                "upper": predicted + margin,
            }
        )

    last_value = float(values[-1])
    growth = (predictions[-1]["forecast"] - last_value) / abs(last_value) * 100 if last_value else 0.0
    return {
        "slope": float(slope),
        "r_squared": r_squared,
        "growth": growth,
        "predictions": predictions,
        "backtest_periods": len(errors),
        "mae": float(np.mean(errors)) if errors else None,
        "mape": float(np.mean(percentage_errors) * 100) if percentage_errors else None,
        "historical": values,
        "fitted": fitted,
    }


def local_answer(question: str, frame: pd.DataFrame, report: dict, forecast: dict | None, metric: str | None) -> str:
    if not metric:
        return f"I cleaned {report['rows']} records across {len(frame.columns)} columns. This dataset has no numeric columns to summarize."

    stats = frame[metric].describe()
    normalized = question.lower()
    if re.search(r"\b(hi|hello|hey|help)\b", normalized):
        return f"Hello! Ask me for the average or range of **{metric}**, the top records, a category breakdown, or a forecast."

    if re.search(r"\b(top|highest|maximum|largest|peak)\b", normalized):
        rows = frame.nlargest(3, metric).head(3)
        return f"Top records by **{metric}**:\n\n" + "\n".join(
            f"- **{row[metric]:,.2f}** — {', '.join(str(row[column]) for column in report['categorical_columns'][:2]) or 'Record ' + str(index + 1)}"
            for index, row in rows.iterrows()
        )

    if re.search(r"\b(bottom|lowest|minimum|smallest)\b", normalized):
        rows = frame.nsmallest(3, metric).head(3)
        return f"Lowest records by **{metric}**:\n\n" + "\n".join(
            f"- **{row[metric]:,.2f}** — {', '.join(str(row[column]) for column in report['categorical_columns'][:2]) or 'Record ' + str(index + 1)}"
            for index, row in rows.iterrows()
        )

    if re.search(r"\b(forecast|predict|future)\b", normalized) and forecast:
        return (
            f"Linear trend forecast for **{metric}**: **{forecast['predictions'][-1]['forecast']:,.2f}** "
            f"at the end of the selected horizon, with **R² {forecast['r_squared']:.3f}**. "
            "Treat this simple trend as directional, not a guarantee."
        )

    if re.search(r"\b(breakdown|group|category|segment|region|by)\b", normalized) and report["categorical_columns"]:
        group_column = next(
            (
                column
                for column in report["categorical_columns"]
                if column.lower().replace("_", " ") in normalized
            ),
            report["categorical_columns"][0],
        )
        totals = frame.groupby(group_column, dropna=False)[metric].sum().sort_values(ascending=False).head(8)
        return f"**{metric} by {group_column}** (totals):\n\n" + "\n".join(
            f"- **{name}**: {value:,.2f}" for name, value in totals.items()
        )

    return (
        f"**{metric}** has a mean of **{stats['mean']:,.2f}**, median **{stats['50%']:,.2f}**, "
        f"and range **{stats['min']:,.2f}–{stats['max']:,.2f}** across {len(frame)} cleaned records. "
        "Ask for top records, a category breakdown, or a forecast for a more specific answer."
    )


def ask_gemini(question: str, frame: pd.DataFrame, report: dict, metric: str | None) -> str | None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    try:
        api_key = st.secrets["GEMINI_API_KEY"].strip()
    except (KeyError, FileNotFoundError):
        pass
    if not api_key:
        return None

    summary = {
        "rows": report["rows"],
        "columns": list(frame.columns),
        "numeric_columns": report["numeric_columns"],
        "categorical_columns": report["categorical_columns"],
        "statistics": frame[report["numeric_columns"]].describe().round(2).to_dict()
        if report["numeric_columns"]
        else {},
        "sample_rows": frame.head(30).to_dict(orient="records"),
    }
    payload = {
        "systemInstruction": {
            "parts": [
                {
                    "text": (
                        "You are a data analyst. Answer the user's question accurately using only the supplied dataset summary. "
                        "Do not claim correlation proves causation. If the summary lacks the requested detail, say so."
                    )
                }
            ]
        },
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            f"Selected metric: {metric or 'none'}\nDataset summary: "
                            f"{json.dumps(summary, default=str)}\nQuestion: {question}"
                        )
                    }
                ],
            }
        ],
    }
    request = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
        answer = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        return answer.strip() or None
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError):
        return None


def dataframe_to_csv(frame: pd.DataFrame) -> bytes:
    return frame.to_csv(index=False).encode("utf-8")


st.title("📊 AI Data Analyst & Business Intelligence Copilot")
st.caption("Explore a dataset, inspect its quality, build visualizations, and run a simple trend forecast.")

with st.sidebar:
    st.header("Your dataset")
    uploaded_file = st.file_uploader("Upload a CSV file (up to 10 MB)", type=["csv"])
    sample_choice = st.selectbox(
        "Or choose a sample",
        ["Retail sales", "Use uploaded CSV"],
        index=0 if uploaded_file is None else 1,
    )
    st.caption("CSV data is processed in this app session. For AI answers, add GEMINI_API_KEY to Streamlit secrets.")

if uploaded_file is not None and sample_choice == "Use uploaded CSV":
    dataset_name = uploaded_file.name
    dataset_bytes = uploaded_file.getvalue()
else:
    sample_path = os.path.join(os.path.dirname(__file__), "sample_retail_sales.csv")
    dataset_name = "Retail Sales & Revenue"
    with open(sample_path, "rb") as sample_file:
        dataset_bytes = sample_file.read()

try:
    data, audit = parse_dataset(dataset_bytes)
except ValueError as error:
    st.error(str(error))
    st.stop()

numeric_columns = audit["numeric_columns"]
categorical_columns = audit["categorical_columns"]
if not numeric_columns:
    st.warning("No numeric columns were detected. Upload a dataset with numeric values to see statistics and forecasts.")

st.subheader(dataset_name)
kpi1, kpi2, kpi3, kpi4 = st.columns(4)
kpi1.metric("Clean records", f"{audit['rows']:,}")
kpi2.metric("Data health", f"{audit['quality']}%")
kpi3.metric("Duplicates removed", f"{audit['duplicates_removed']:,}")
kpi4.metric("Missing cells filled", f"{audit['missing_imputed']:,}")

overview, charts, forecasting, cleaning, copilot = st.tabs(
    ["Overview", "Visualizations", "Forecast", "Data quality & statistics", "AI Copilot"]
)

with overview:
    st.subheader("Dataset overview")
    if numeric_columns:
        chosen_metric = st.selectbox("Primary metric", numeric_columns, key="overview_metric")
        metric_stats = data[chosen_metric].describe()
        first, second, third = st.columns(3)
        first.metric(f"Total {chosen_metric}", f"{data[chosen_metric].sum():,.2f}")
        second.metric("Average", f"{metric_stats['mean']:,.2f}")
        third.metric("Median", f"{metric_stats['50%']:,.2f}")
        if categorical_columns:
            group_column = st.selectbox("Break down by", categorical_columns, key="overview_group")
            grouped = (
                data.groupby(group_column, dropna=False)[chosen_metric]
                .sum()
                .sort_values(ascending=False)
                .head(10)
            )
            st.bar_chart(grouped)
    st.dataframe(data.head(20), use_container_width=True, hide_index=True)

with charts:
    st.subheader("Explore a metric")
    if numeric_columns:
        chart_metric = st.selectbox("Metric", numeric_columns, key="chart_metric")
        chart_kind = st.selectbox("Chart type", ["Bar", "Line", "Histogram", "Scatter"])
        if chart_kind == "Histogram":
            figure, axis = plt.subplots(figsize=(10, 4))
            axis.hist(data[chart_metric].dropna(), bins="auto", color="#3B5BFD", edgecolor="white")
            axis.set_xlabel(chart_metric)
            axis.set_ylabel("Records")
            axis.set_title(f"Distribution of {chart_metric}")
            st.pyplot(figure, clear_figure=True)
        elif chart_kind == "Scatter" and len(numeric_columns) > 1:
            x_metric = st.selectbox(
                "Compare against",
                [column for column in numeric_columns if column != chart_metric],
            )
            st.scatter_chart(data, x=x_metric, y=chart_metric, use_container_width=True)
        elif chart_kind == "Scatter":
            st.info("A scatter plot needs at least two numeric columns.")
        elif categorical_columns:
            axis_column = st.selectbox("Category or period", categorical_columns, key="chart_axis")
            grouped = data.groupby(axis_column, dropna=False)[chart_metric].sum()
            if chart_kind == "Line":
                st.line_chart(grouped, use_container_width=True)
            else:
                st.bar_chart(grouped, use_container_width=True)
        else:
            if chart_kind == "Line":
                st.line_chart(data[chart_metric], use_container_width=True)
            else:
                st.bar_chart(data[chart_metric], use_container_width=True)
    else:
        st.info("Add a numeric column to create charts.")

with forecasting:
    st.subheader("Linear trend forecast")
    st.caption("Forecasts extrapolate a straight-line trend in row order; they do not model seasonality or guarantee future results.")
    if numeric_columns:
        forecast_metric_name = st.selectbox("Metric to forecast", numeric_columns, key="forecast_metric")
        horizon = st.slider("Future periods", min_value=1, max_value=12, value=4)
        forecast = forecast_metric(data, forecast_metric_name, horizon)
        if forecast is None:
            st.info("At least two valid numeric observations are needed.")
        else:
            first, second, third = st.columns(3)
            first.metric("Trend per row", f"{forecast['slope']:+,.2f}")
            second.metric("R² (in-sample)", f"{forecast['r_squared']:.3f}")
            third.metric(
                "Backtest MAE",
                "N/A" if forecast["mae"] is None else f"{forecast['mae']:,.2f}",
                help=f"Walk-forward holdout across {forecast['backtest_periods']} recent records.",
            )
            history = pd.DataFrame(
                {"Actual": forecast["historical"], "Trend": forecast["fitted"]},
                index=np.arange(1, len(forecast["historical"]) + 1),
            )
            future = pd.DataFrame(
                {
                    "Forecast": [item["forecast"] for item in forecast["predictions"]],
                    "Lower range": [item["lower"] for item in forecast["predictions"]],
                    "Upper range": [item["upper"] for item in forecast["predictions"]],
                },
                index=np.arange(len(history) + 1, len(history) + horizon + 1),
            )
            st.line_chart(history, use_container_width=True)
            st.line_chart(future, use_container_width=True)
            st.dataframe(pd.DataFrame(forecast["predictions"]), use_container_width=True, hide_index=True)

with cleaning:
    st.subheader("Cleaning audit")
    st.write(
        {
            "Rows uploaded": audit["initial_rows"],
            "Rows after exact duplicate removal": audit["rows"],
            "Duplicates removed": audit["duplicates_removed"],
            "Missing values imputed": audit["missing_imputed"],
            "Numeric columns": numeric_columns,
            "Categorical columns": categorical_columns,
        }
    )
    if numeric_columns:
        st.subheader("Descriptive statistics")
        st.dataframe(data[numeric_columns].describe().T, use_container_width=True)
        if len(numeric_columns) > 1:
            st.subheader("Numeric correlations")
            st.dataframe(data[numeric_columns].corr().round(3), use_container_width=True)
    st.subheader("Cleaned data")
    st.dataframe(data, use_container_width=True, hide_index=True)
    st.download_button(
        "Download cleaned CSV",
        data=dataframe_to_csv(data),
        file_name="cleaned_dataset.csv",
        mime="text/csv",
    )

with copilot:
    st.subheader("Ask about your data")
    primary_metric = numeric_columns[0] if numeric_columns else None
    if numeric_columns:
        primary_metric = st.selectbox("Default metric", numeric_columns, key="chat_metric")
    if "chat_history" not in st.session_state:
        st.session_state.chat_history = []

    for message in st.session_state.chat_history:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    question = st.chat_input("Ask for a summary, top records, group breakdown, or forecast")
    if question:
        st.session_state.chat_history.append({"role": "user", "content": question})
        with st.chat_message("user"):
            st.markdown(question)
        with st.chat_message("assistant"):
            with st.spinner("Analyzing the dataset…"):
                answer = ask_gemini(question, data, audit, primary_metric)
                if answer is None:
                    local_forecast = (
                        forecast_metric(data, primary_metric, 4)
                        if primary_metric and re.search(r"\b(forecast|predict|future)\b", question.lower())
                        else None
                    )
                    answer = local_answer(question, data, audit, local_forecast, primary_metric)
                st.markdown(answer)
        st.session_state.chat_history.append({"role": "assistant", "content": answer})

    st.download_button(
        "Download current analysis summary",
        data=(
            f"Dataset: {dataset_name}\nGenerated: {datetime.now().isoformat(timespec='seconds')}\n"
            f"Rows: {audit['rows']}\nData health: {audit['quality']}%\n"
            f"Numeric columns: {', '.join(numeric_columns)}\n"
            f"Categorical columns: {', '.join(categorical_columns)}\n"
        ),
        file_name="analysis_summary.txt",
        mime="text/plain",
    )
