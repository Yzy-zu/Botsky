import os
import re

file_map = {
    'server': 'core/server',
    'dispatcher': 'core/dispatcher',
    'queue': 'core/queue',
    'parser': 'core/parser',
    
    'db': 'services/db',
    'evolution': 'services/evolution',
    'logger': 'services/logger',
    
    'ayuda': 'commands/ayuda',
    'convertir': 'commands/convertir',
    'descargar': 'commands/descargar',
    'documentos': 'commands/documentos',
    'efectos': 'commands/efectos',
    'info': 'commands/info',
    'maicra': 'commands/maicra',
    'moderacion': 'commands/moderacion',
    'niveles': 'commands/niveles',
    'ocr': 'commands/ocr',
    'qr': 'commands/qr',
    'spotify': 'commands/spotify',
    'sticker': 'commands/sticker',
    'transcribir': 'commands/transcribir'
}

def get_rel_path(from_dir, to_module):
    # from_dir is e.g. "src/core"
    # to_module is e.g. "services/logger"
    
    parts_from = from_dir.split('/')
    parts_to = to_module.split('/')
    
    # how many levels to go up
    # Since from_dir is src/something, depth is len(parts_from) - 1. 
    # e.g. from src/core to src/services/logger -> ../services/logger
    ups = len(parts_from[1:])
    rel = '../' * ups + to_module
    
    if not rel.startswith('.'):
        rel = './' + rel
        
    return rel

for root, _, files in os.walk('src'):
    for file in files:
        if file.endswith('.js'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r') as f:
                content = f.read()
                
            # Replace require('./module') or require('../module')
            def replace_req(m):
                module_name = m.group(1).split('/')[-1]
                if module_name in file_map:
                    new_rel = get_rel_path(root, file_map[module_name])
                    return f"require('{new_rel}')"
                return m.group(0)
                
            new_content = re.sub(r"require\(['\"](\.[^'\"]+)['\"]\)", replace_req, content)
            
            # Specifically for transcribir.js python script
            if file == 'transcribir.js':
                new_content = new_content.replace("'./transcribe.py'", "require('path').join(__dirname, '../scripts/transcribe.py')")
                new_content = new_content.replace("path.join(__dirname, 'transcribe.py')", "path.join(__dirname, '../scripts/transcribe.py')")
            
            with open(filepath, 'w') as f:
                f.write(new_content)

print("Requires fixed.")
