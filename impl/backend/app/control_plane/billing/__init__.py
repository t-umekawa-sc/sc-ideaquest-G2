"""請求書「機能」（ドメインV・使用料請求書・SC-92）。4層＝router/application/schemas/domain。

帳票**基盤**（`app/infra/reports`）とは責務分離＝本パッケージは「何を印字するか（請求書データの組み立て）」の
純粋ロジック（`domain/invoice.py`）と、認可/テナント/レンダラ選択の調停（`application.py`）を持つ。描画そのもの
（Jasper／純 Python）はレンダラ port に閉じる。設計 §6・API設計 V.1。
"""
