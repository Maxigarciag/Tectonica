@echo off
set PATH=C:\Users\maxim\scoop\apps\postgresql\current\bin;%PATH%
pg_ctl -D C:\Users\maxim\scoop\apps\postgresql\18.7-1\data3 -l C:\Users\maxim\scoop\apps\postgresql\current\logfile3.log -o "-p 5433" start
