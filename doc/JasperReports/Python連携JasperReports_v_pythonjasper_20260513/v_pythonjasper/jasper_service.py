import os
import configparser
from pyreportjasper import PyReportJasper

# INIファイルの読み込み
config = configparser.ConfigParser()

# config.iniを読み込む
config_path = os.path.join(os.path.dirname(__file__), 'config.ini')
config.read(config_path, encoding='utf-8')

# config.iniからDB_CONFIG設定
DB_CONFIG = {
    'driver': config.get('DATABASE', 'driver'),
    'username': config.get('DATABASE', 'user'),
    'password': config.get('DATABASE', 'password'),
    'host': config.get('DATABASE', 'host'),
    'database': config.get('DATABASE', 'name'),
    'port': config.get('DATABASE', 'port'),
    'jdbc_driver': config.get('JDBC', 'driver_class'),
    'jdbc_dir': os.path.join(os.path.dirname(os.path.abspath(__file__)), "drivers")
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def generate_report_file(report_id: str, fmt: str, group: str):
    """
    JasperReportを実行し、生成されたファイルのパスを返す。
    """
    input_file = os.path.join(BASE_DIR, "reports", group, f"{report_id}.jrxml")
    output_base = os.path.join("/tmp", report_id)
    target_format = fmt.lower()
    
    if not os.path.exists(input_file):
        raise FileNotFoundError(f"Template not found: {input_file}")

    # RHEL 8 描画エラー回避-特にFontが設置されていない場合の対応、J
    os.environ['JAVA_OPTS'] = "-Djava.awt.headless=true"

    jasper = PyReportJasper()
    jasper.config(
        input_file=input_file,
        output_file=output_base,
        db_connection=DB_CONFIG,
        output_formats=[target_format]
    )

    jasper.process_report()

    final_file_path = f"{output_base}.{target_format}"
    
    if not os.path.exists(final_file_path):
        raise FileNotFoundError(f"Jasper failed to create: {final_file_path}")

    return final_file_path