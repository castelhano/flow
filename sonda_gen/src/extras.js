function floatFormat(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}


function timeAdd(hhmm, hadd=0, madd=0){
    let hh = parseInt(hhmm.slice(0, -2)) + hadd;
    let mm = parseInt(hhmm.slice(-2)) + madd;
    while(mm > 59){hh++;mm -= 60;}
    while(mm < 0){hh--;mm += 60;}
    return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;    
}