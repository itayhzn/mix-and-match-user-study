"""
A local stand-in for GitHub Pages and the Apps Script: serves the site and appends every POST to /submit to a JSON
lines file, answering {"ok": true} like the script does. For testing only.

    python3 tools/dev_server.py [--port 8000] [--records tools/records.jsonl]
    open http://localhost:8000/?submit=http://localhost:8000/submit
"""
import argparse
import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    records = None
    fail = False

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path.split("?")[0] == "/fail":
            Handler.fail = not Handler.fail
            return self.reply({"fail": Handler.fail})
        if self.path.split("?")[0] != "/submit":
            return self.send_error(404)
        if Handler.fail:
            return self.send_error(503)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        record = json.loads(body)
        with open(Handler.records, "a") as file:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.reply({"ok": True})

    def reply(self, data):
        payload = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--records", type=Path, default=ROOT / "tools" / "records.jsonl")
    args = parser.parse_args()
    Handler.records = args.records
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(ROOT)))
    print(f"http://localhost:{args.port}/?submit=http://localhost:{args.port}/submit", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
