"""Copy the Listening Lab audio files from Google Drive to this website.

Reads the exercises sheet (shared "Anyone with the link: Viewer"), finds each Google Drive link in the
"Audio" column, and keeps audio/<Drive file ID>.mp3 in step with it: new files are downloaded and
converted to MP3 (plays everywhere, including old iPads); files no longer in the sheet are removed.
The Drive files must be shared as "Anyone with the link: Viewer".
"""
import csv, io, os, re, subprocess, sys, tempfile, urllib.request

SHEET_ID = "16z4gUtwyRlwHIPSjgKIvfeBmIkw3T3RQamY_AEdFPXw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "audio")
UA = {"User-Agent": "Mozilla/5.0 (Emerald Listening Lab audio sync)"}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)

def drive_id(u):
    m = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", u or "") or re.search(r"[?&]id=([A-Za-z0-9_-]{10,})", u or "")
    return m.group(1) if m else None

def main():
    os.makedirs(OUT, exist_ok=True)
    text = get(f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&headers=1").read().decode("utf-8")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        sys.exit("The exercises sheet is empty or could not be read.")
    head = [h.strip().lower() for h in rows[0]]
    col = next((i for i, h in enumerate(head) if h.startswith("audio")), None)
    if col is None:
        sys.exit("No 'Audio' column in the exercises sheet.")
    wanted = {i for i in (drive_id(r[col]) for r in rows[1:] if len(r) > col) if i}
    print(f"{len(wanted)} audio file(s) listed in the sheet")
    failed = []
    for fid in sorted(wanted):
        dest = os.path.join(OUT, fid + ".mp3")
        if os.path.exists(dest):
            continue
        print("Copying", fid)
        try:
            r = get(f"https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t")
            if "text/html" in (r.headers.get("Content-Type") or ""):
                raise RuntimeError("Drive returned a web page, not a file (is it shared as 'Anyone with the link'?)")
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp.write(r.read())
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-vn", "-ac", "1", "-b:a", "96k", dest], check=True)
            os.unlink(tmp.name)
        except Exception as e:
            failed.append(fid)
            print(f"  could not copy {fid}: {e}")
            if os.path.exists(dest):
                os.unlink(dest)
    for f in os.listdir(OUT):
        if f.endswith(".mp3") and f[:-4] not in wanted:
            print("Removing", f)
            os.unlink(os.path.join(OUT, f))
    if failed:
        print(f"::warning::{len(failed)} audio file(s) could not be copied: {', '.join(failed)}")

main()
