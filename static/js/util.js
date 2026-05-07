function copyAppPath() {
    // 1. Obtém o caminho completo (Ex: file:///C:/Pasta/arquivo.html)
    let caminhoRaw = window.location.href;
    
    // 2. Remove o nome do arquivo (tudo após a última barra)
    let pastaRaw = caminhoRaw.substring(0, caminhoRaw.lastIndexOf('/'));
    
    // 3. Converte para o formato de pastas do Windows
    let caminhoPastaWindows = decodeURI(pastaRaw)
        .replace('file:///', '')   // Remove o protocolo
        .replace(/\//g, '\\');     // Inverte as barras
    
    // 4. Copia para a área de transferência
    navigator.clipboard.writeText(caminhoPastaWindows).then(() => {
        console.log("Caminho copiado: " + caminhoPastaWindows);
    });
}
