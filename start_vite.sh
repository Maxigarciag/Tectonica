#!/bin/bash
cd /c/Users/maxim/OneDrive/Desktop/pulso-de-la-tierra/frontend
export PATH="/c/programacion/node:$PATH"
nohup npm run dev -- --port 5173 > vite.log 2>&1 &
echo "Vite PID: $!"
sleep 8
# Verificar
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/ 2>/dev/null | grep -q "200\|304"; then
    echo "Vite: OK"
else
    echo "Vite: FALLO"
    cat vite.log
fi
# Verificar proxy
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/api/v1/earthquakes?window=hour 2>/dev/null | grep -q "200"; then
    echo "Proxy API: OK"
else
    echo "Proxy API: FALLO"
fi
