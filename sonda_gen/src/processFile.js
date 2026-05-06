var linhas = {};
function processFile(){
    linhas = {}; // Reinicializa linhas
    let file = document.getElementById('id_file').files;
    let cnsl = document.getElementById('cnsl');
    let linhas_container = document.getElementById('linhas_container');
    cnsl.innerHTML = ''; // Limpa o console
    linhas_container.innerHTML = ''; // Limpa as linhas se carregadas previamente
    let prefixo = null;
    
    var fr = new FileReader();

    // Method chamado apos fazer leitura do arquivo
    fr.onload = function(){
        cnsl.innerHTML = 'Aguarde, processando arquivo...';
        let raw = fr.result;
        var file_size = 0;
        var linhas_size = 0;
        var error = false;
        try{
            var rows = raw.split('\n');
            file_size = rows.length;
            let row_size = rows[0].split(';').length || null; // Verifica a quantidade de 'colunas' para cada linha
            if(file_size < 1 || row_size < 27 || row_size > 29){ // Valida se arquivo tem pelo menos 1 registro e a quantidade correta de campos
                error = true;
                cnsl.innerHTML = 'Arquivo em formato inválido....';
            }
            else{ // Se arquivo valido...
                prefixo = rows[0].split(';')[22];
                for(let i = 0; i < file_size; i++){ // Percorre todas as linhas, populando o dicionario linhas com as respectivas viagens
                    let row = rows[i].split(';');
                    if(row[0] == "" || row[0] == "\n" || row[0] == "\r" ){} // Descarta elemetos vazios
                    else if(linhas[`${row[0]}`] !== undefined){ // Se linha ja existe no dicionario de linhas, faz push do row
                        if(row[9] == '1'){
                            // Posicao 9 do array define 1 para viagens produtivas e 0 para improdutivas, somente sera carregado viagens produtivas
                            row[12] = row[12] == '0000' ? '2359' : timeAdd(row[12],0,-1); // Horario de termino da viagem nao pode ser igual ao horario de inicio (padrao do globus), eh reduzido 1 minuto no final da viagem
                            linhas[`${row[0]}`].push(row);
                        }
                    }
                    else{ // Caso linha ainda nao esteja cadastrada no dicionario de linhas, cria primeiro registro
                        if(row[9] == '1'){
                            row[12] = timeAdd(row[12],0,-1) // Horario de termino da viagem nao pode ser igual ao horario de inicio (padrao do globus), eh reduzido 1 minuto no final da viagem
                            linhas[`${row[0]}`] = [row];
                            linhas_size++;
                            let item_onclick = `onclick="linhaPreview('${row[0]}')"`
                            let list_item = `<li data-value="${row[0]}" ${item_onclick}>${row[0]}</li>`;
                            linhas_container.innerHTML += list_item;
                        }
                        else{
                        }
                    }
                }
                if(autoSelectCompany){ // Caso variavel autoSelectCompany (empresas.js) esteja setada para true, tenta selecionar empresa correspondente
                    try{
                        let initial = String(parseInt(prefixo))[0]; // Pega digito inicial do veiculo na primeira linha do arquivo
                        if(initial in company){ // Se existir chave correspondente do dicionario company, seleciona empresa correspondente
                            document.getElementById('id_empresa').value = company[initial];
                        }
                    }catch(error){console.log(error);}
                    
                }
            }
        }
        catch(error){console.log(error);} 
        if(!error){
            document.getElementById('section-work').classList.remove('d-none');
            document.getElementById('btnGerarTodos').classList.remove('d-none');
            cnsl.innerHTML =
                `<b>Análise concluída</b> — <b>${floatFormat(file_size)}</b> registros em <b>${linhas_size}</b> linhas` +
                `<br><span class="cnsl-sep">──────────────────────────────</span><br>` +
                `Selecione uma linha para pré-visualizar ou clique em ` +
                `<button class="btn btn-primary" onclick="gerarTodos()" style="padding:3px 10px;">Gerar todos</button>`;
        }
    }
    
    fr.readAsText(file[0]); // Abre e le arquivo
}