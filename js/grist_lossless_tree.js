/* Encodage en lignes JSON sans perte des champs d'une sauvegarde ; aucune E/S réseau. */
(function () {
    const token = p => JSON.stringify(p);
    window.encodeDnbTree = function (root) {
        const rows=[];
        function walk(value,path) {
            let kind;
            if(value===null)kind='null';else if(Array.isArray(value))kind='array';else kind=typeof value;
            if(!['null','array','object','string','number','boolean'].includes(kind) || (kind==='number'&&!Number.isFinite(value)))throw new Error('Valeur non compatible JSON.');
            rows.push({Chemin:token(path),Type:kind,Valeur:(kind==='array'||kind==='object')?'':JSON.stringify(value)});
            if(kind==='array') value.forEach((v,i)=>walk(v,[...path,i]));
            if(kind==='object') for(const [k,v] of Object.entries(value)) walk(v,[...path,k]);
        }
        walk(root,[]);return rows;
    };
    window.decodeDnbTree = function (rows) {
        const nodes=new Map();
        for(const row of rows){let path;try{path=JSON.parse(row.Chemin);}catch{throw new Error('Chemin invalide.');}if(!Array.isArray(path)||path.some(p=>typeof p!=='string'&&!(Number.isInteger(p)&&p>=0)))throw new Error('Chemin invalide.');const k=token(path);if(nodes.has(k))throw new Error('Chemin dupliqué.');let value;if(row.Type==='array')value=[];else if(row.Type==='object')value={};else {try{value=JSON.parse(row.Valeur);}catch{throw new Error('Valeur JSON invalide.');}const actual=value===null?'null':typeof value;if(actual!==row.Type || (typeof value==='number'&&!Number.isFinite(value)))throw new Error('Type de valeur incohérent.');}nodes.set(k,{path,value,kind:row.Type});}
        if(!nodes.has('[]'))throw new Error('Racine manquante.');
        const sorted=[...nodes.values()].sort((a,b)=>{const depth=a.path.length-b.path.length;if(depth)return depth;const ap=token(a.path.slice(0,-1)),bp=token(b.path.slice(0,-1));if(ap!==bp)return ap<bp?-1:1;const x=a.path[a.path.length-1],y=b.path[b.path.length-1];return typeof x==='number'&&typeof y==='number'?x-y:0;});
        for(const node of sorted){if(!node.path.length)continue;const parent=nodes.get(token(node.path.slice(0,-1)));const part=node.path[node.path.length-1];if(!parent || !['array','object'].includes(parent.kind))throw new Error('Parent manquant ou invalide.');if(parent.kind==='array' && (!Number.isInteger(part)||part!==parent.value.length))throw new Error('Indices de tableau invalides.');if(parent.kind==='object' && typeof part!=='string')throw new Error('Clé d’objet invalide.');Object.defineProperty(parent.value,part,{value:node.value,enumerable:true,configurable:true,writable:true});}
        return nodes.get('[]').value;
    };
})();
