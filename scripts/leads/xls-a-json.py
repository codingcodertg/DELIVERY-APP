# Convierte el .xls (Excel binario viejo) de permisos municipales a JSON: una lista de objetos con las cabeceras de la
# primera fila como claves. Node no lee .xls; Python con xlrd si. Uso:
#   python scripts/leads/xls-a-json.py "C:/ruta/Report.xls" salida.json
# Si falta xlrd: pip install xlrd (o pip install --target <carpeta> xlrd y PYTHONPATH=<carpeta>).
import json, sys
try:
    import xlrd
except ImportError:
    sys.exit("falta xlrd: pip install xlrd")
origen, destino = sys.argv[1], sys.argv[2]
wb = xlrd.open_workbook(origen)
sh = wb.sheet_by_index(0)
H = [str(sh.cell_value(0, c)).strip() for c in range(sh.ncols)]
filas = []
for r in range(1, sh.nrows):
    fila = {}
    for c in range(sh.ncols):
        v = sh.cell_value(r, c)
        tipo = sh.cell_type(r, c)
        if tipo == xlrd.XL_CELL_DATE:
            v = xlrd.xldate_as_datetime(v, wb.datemode).date().isoformat()
        elif tipo == xlrd.XL_CELL_NUMBER and H[c] == "Issued Date":
            v = xlrd.xldate_as_datetime(v, wb.datemode).date().isoformat()
        elif isinstance(v, float) and v.is_integer():
            v = int(v)
        fila[H[c]] = v
    if any(str(x).strip() for x in fila.values()):
        filas.append(fila)
json.dump({"hoja": sh.name, "filas": filas}, open(destino, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(f"{sh.name}: {len(filas)} filas, {len(H)} columnas -> {destino}")
