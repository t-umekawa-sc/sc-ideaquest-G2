'use client'; // ブラウザ側で動かすコンポーネントであることを宣言

export default function JasperReportPage() {
  
  // レポート生成ボタンのハンドラー
  const handleDownload = () => {
    // 1. FastAPIのベースURL（Docker環境に合わせて指定）
    const baseUrl = 'http://localhost:8000/generate';
    
    // 2. クエリパラメータの準備
    const params = new URLSearchParams({
      report_id: 'main_jrxml', // テンプレートファイル名
      format: 'pdf',           // 出力形式
      group: 'group_a'         // グループ名
    });

    // 3. ブラウザで開く（FastAPIがContent-Dispositionを返せばダウンロード開始）
    window.open(`${baseUrl}?${params.toString()}`, '_blank');
  };

  return (
    <div style={{ padding: '50px', textAlign: 'center' }}>
      <h1>JasperReport 出力</h1>
      <button 
        onClick={handleDownload}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer',
          backgroundColor: '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '5px'
        }}
      >
        PDFレポートをダウンロード
      </button>
    </div>
  );
}