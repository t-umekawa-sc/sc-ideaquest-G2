"""帳票基盤（ドメインV・JasperReports 疎結合連携）＝描画を差し替え可能な port に閉じる層。

LLM ゲートウェイ（`infra/llm`）と同じ流儀＝「何を印字するか（帳票データ組み立て）」は自前ドメインの
純粋ロジック、「どう描画するか（PDF 化）」は `ReportRenderer` port の実装（Jasper／純 Python fallback）。
`REPORT_RENDERER` で着脱し、Jasper は内部ネットワーク限定の純レンダラ（データ・プッシュ JSON・S2S 秘密）。
設計元＝doc/設計ドラフト/帳票連携(JasperReports)_設計.md・API設計 V。
"""
