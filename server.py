#!/usr/bin/env python3
"""
PlanLekcji – lokalny serwer HTTP
Uruchom: python3 server.py  (lub dwuklik na Windows)
Otworzy się automatycznie w przeglądarce pod http://localhost:8765
"""
import http.server, socketserver, webbrowser, threading, os, sys

PORT = 8765
DIR  = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIR, **kw)
    def log_message(self, fmt, *args):
        pass   # cicha praca

def open_browser():
    import time; time.sleep(0.8)
    webbrowser.open(f'http://localhost:{PORT}/index.html')

threading.Thread(target=open_browser, daemon=True).start()
print(f"PlanLekcji działa na http://localhost:{PORT}")
print("Naciśnij Ctrl+C aby zatrzymać.")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nSerwer zatrzymany.")
