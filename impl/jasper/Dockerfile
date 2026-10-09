# Jasper レンダリングサービス＝Java(JasperReports/JasperStarter)＋Python(FastAPI) の最小イメージ。
# サンプル Dockerfile.txt の D1〜D4 を是正＝固定タグ・非再現 update 撤去・版ピン・行継続コメント混入なし。
# JRE で十分（JasperStarter はバンドルの JasperReports コンパイラで jrxml を実行＝javac 不要）。
FROM eclipse-temurin:11-jre-jammy

ENV JAVA_OPTS="-Djava.awt.headless=true" \
    LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Python ランタイムと、SansSerif 論理フォントの実体（DejaVu）＋fontconfig（headless 描画の font 解決）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         python3 python3-pip fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# アプリ本体＋テンプレートをイメージにベイク（volumes マウントしない＝backend と同方針）。
COPY app.py warmup.py _secrets.py ./
COPY reports ./reports

# ビルド時ウォームアップ＝JasperStarter/JVM 資産のベイク＋jrxml コンパイル検証（壊れていれば build 失敗）。
RUN python3 warmup.py

# 非 root 実行（専用ユーザ）。ベイク済み資産は読取のみで足りる。
RUN useradd --system --create-home --uid 10001 jasper \
    && chown -R jasper:jasper /app
USER jasper

EXPOSE 8000

# ヘルスチェック（curl 非依存＝標準ライブラリで /health を叩く）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health',timeout=3).status==200 else 1)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
