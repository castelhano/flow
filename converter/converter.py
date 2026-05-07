import pandas as pd
import sys
import os
import glob
import time
from datetime import datetime

def format_time(seconds):
    return time.strftime("%H:%M:%S", time.gmtime(seconds))

def converter():
    # Lógica de seleção: se houver argumento, usa ele. Se não, busca todos.
    if len(sys.argv) > 1:
        arquivos = [sys.argv[1]]
        modo_lote = False
    else:
        arquivos = glob.glob("*.xls*")
        modo_lote = True
    
    if not arquivos or (not modo_lote and not os.path.exists(arquivos[0])):
        print(" [!] Nenhum arquivo encontrado ou o arquivo especificado nao existe.")
        return

    inicio_geral = time.time()
    
    print("="*60)
    tipo_proc = "EM LOTE" if modo_lote else "INDIVIDUAL"
    print(f" INICIANDO CONVERSAO {tipo_proc} - {datetime.now().strftime('%H:%M:%S')}")
    print(f" Arquivos na fila: {len(arquivos)}")
    print("="*60)

    for idx, entrada in enumerate(arquivos, 1):
        if not entrada.lower().endswith(('.xls', '.xlsx', '.xlsm')):
            continue

        inicio_arquivo = time.time()
        saida = os.path.splitext(entrada)[0] + ".csv"
        
        print(f"\n[{idx}/{len(arquivos)}] Processando: {entrada}")
        print(f" {'-'*20}")

        try:
            with pd.ExcelFile(entrada) as xls:
                for i, nome_aba in enumerate(xls.sheet_names):
                    df = pd.read_excel(xls, sheet_name=nome_aba)
                    
                    modo = 'w' if i == 0 else 'a'
                    header = True if i == 0 else False
                    df.to_csv(saida, mode=modo, index=False, header=header, encoding='utf-8-sig', sep=';')
                    
                    print(f"  > Aba '{nome_aba}' ok.")

            tempo_arq = time.time() - inicio_arquivo
            print(f" {'-'*20}")
            print(f" [+] Finalizado em {tempo_arq:.2f}s")

        except Exception as e:
            print(f" [X] ERRO ao processar {entrada}: {e}")

    tempo_total = time.time() - inicio_geral
    print("\n" + "="*60)
    print(f" PROCESSO CONCLUÍDO EM {format_time(tempo_total)}")
    print("="*60)

if __name__ == "__main__":
    converter()