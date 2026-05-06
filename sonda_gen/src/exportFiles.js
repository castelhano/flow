
function gerarTodos(){exportFiles(linhas);}
function gerarLinha(cod){let viag = linhas[cod];let linha = {};linha[cod] = viag;exportFiles(linha);}


function exportFiles(linhas){
    
    let pl_headers = 'Tabela;Horario_Partida;Tolerancia_Atraso1;Tolerancia_Adiantamento1;Horario_Chegada;Tolerancia_Atraso2;Tolerancia_Adiantamento2;passagem1;permanencia1;passagem2;permanencia2;passagem3;permanencia3;passagem4;permanencia4;passagem5;permanencia5;passagem6;permanencia6;passagem7;permanencia7;passagem8;permanencia8;passagem9;permanencia9;passagem10;permanencia10;empresa\n';
    let es_headers = 'Tabela;Horario Partida;Veiculo\n';
    let nome_empresa = document.getElementById('id_empresa').value;
    let toleranciaPercentual = document.getElementById('id_tolerancia').value;
    let tipo = document.getElementById('id_tipo').value;
    var zip = new JSZip();
    let errors = [];
    let warnings = [];
    
    for (const [key, value] of Object.entries(linhas)) { // Percorre todas as linhas
        let universalBOM = "\uFEFF";
        let viagens_linha = value.length;
        let pl_ida = `${universalBOM}${pl_headers}`, pl_volta = `${universalBOM}${pl_headers}`, es_ida = `${universalBOM}${es_headers}`, es_volta = `${universalBOM}${es_headers}`;
        
        for(let i = 0; i < viagens_linha; i++){ // Percorre as viagens da linha
            let tab = parseInt(value[i][4]);
            if(tab == NaN || tab == '' || !tab){errors.push(`ERRO: Tab ${value[i][4]} tem formato invalido ${value[i][0]} ${value[i][2]}\n`)}
            
            let tolerancia = calculaTolerancia(value[i][11], value[i][12], toleranciaPercentual); // Calcula a tolerancia de atraso e adiantamento (ciclo * percentual)
            if(value[i][10] == 'I'){ // Caso viagem de ida, adiciona viagem e escala nas respectivas strings [pl_ida, es_ida]
                es_ida += `${tab};${value[i][11].slice(0, -2) + ":" + value[i][11].slice(-2)};${parseInt(value[i][22]) || ''}\n`;
                pl_ida += `${tab};${value[i][11].slice(0, -2) + ":" + value[i][11].slice(-2)};${tolerancia};${tolerancia};${value[i][12].slice(0, -2) + ":" + value[i][12].slice(-2)};${tolerancia};${tolerancia};;;;;;;;;;;;;;;;;;;;;${nome_empresa}\n`;
            }
            else if(value[i][10] == 'V'){ // Caso viagem de volta, adiciona viagem e escala nas respectivas strings [pl_volta, es_volta]
                es_volta += `${tab};${value[i][11].slice(0, -2) + ":" + value[i][11].slice(-2)};${parseInt(value[i][22]) || ''}\n`;
                pl_volta += `${tab};${value[i][11].slice(0, -2) + ":" + value[i][11].slice(-2)};${tolerancia};${tolerancia};${value[i][12].slice(0, -2) + ":" + value[i][12].slice(-2)};${tolerancia};${tolerancia};;;;;;;;;;;;;;;;;;;;;${nome_empresa}\n`;
            }
            if(!parseInt(value[i][22])){warnings.push(`ATENCAO: Tab ${value[i][4]} linha ${value[i][0]} sem veiculo escalado`)}
        }
        if(tipo == 'P' || tipo == 'PE'){
            zip.file(`${key}_PL_IDA.csv`, pl_ida);
            zip.file(`${key}_PL_VOLTA.csv`, pl_volta);
        }
        if(tipo == 'E' || tipo == 'PE'){
            zip.file(`${key}_ESC_IDA.csv`, es_ida);
            zip.file(`${key}_ESC_VOLTA.csv`, es_volta);
        }
    }
    let errorsUnq = [...new Set(errors)]; // Remove duplicatas do array de erros
    let warningsUnq = [...new Set(warnings)]; // Remove duplicatas do array de alertas
    let cnsl = document.getElementById('cnsl');
    cnsl.innerHTML =
        `<b>Exportação concluída</b>` +
        `<br><span class="cnsl-sep">──────────────────────────────</span><br>`;
    for(const value of errorsUnq){ cnsl.innerHTML += `<span class="cnsl-error">${value}</span><br>`; }
    for(const value of warningsUnq){ cnsl.innerHTML += `<span class="cnsl-warning">${value}</span><br>`; }
    if(!errorsUnq.length && !warningsUnq.length){ cnsl.innerHTML += 'Nenhuma inconsistência encontrada.'; }
    zip.generateAsync({type:"blob"}).then(function(content) {saveAs(content, "arquivos.zip");})
}

function calculaTolerancia(ida, volta, perc){
    let hh_i = parseInt(ida.slice(0, -2)), mm_i = parseInt(ida.slice(-2));
    let hh_v = parseInt(volta.slice(0, -2)), mm_v = parseInt(volta.slice(-2));
    if(hh_v < hh_i){hh_v += 24} // Ajusta hora caso virada de dia
    return Math.round(((hh_v * 60 + mm_v) - (hh_i * 60 + mm_i)) * (perc / 100))
}