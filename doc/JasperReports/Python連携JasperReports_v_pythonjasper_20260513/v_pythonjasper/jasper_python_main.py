from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from jasper_service import generate_report_file

app = FastAPI(title="JasperReport API")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

#############################
# Next.jsから呼び出すRoute：　”generate”を適当な名称に変更してください
#############################
@app.get("/generate")
###############################
# 引数　：　レポートファイル名、拡張子、レポートグループ(レポートをグループ分けした場合)
###############################
async def api_generate_report(report_id: str, format: str = "pdf", group: str = "default"):
    # ################################### 
    # ここに認証ロジックを組み込む
    #
    # ex : api_authencate_report() 
    # ###################################
    
    try:
        file_path = generate_report_file(report_id, format, group)
        return FileResponse(file_path, media_type="application/octet-stream", filename=f"{report_id}.{format}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))