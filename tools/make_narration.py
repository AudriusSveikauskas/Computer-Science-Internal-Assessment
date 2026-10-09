#!/usr/bin/env python3
"""Turns tools/narration.json into one WAV file per segment with Piper TTS.

    python3 tools/make_narration.py <piper-binary> <voice.onnx> <output-folder> [speed]

Writes <output-folder>/<id>.wav and <output-folder>/durations.json, which
tools/record_video.js reads so that each part of the video lasts as long
as its commentary. The voice is synthetic (text-to-speech).
"""

import json
import os
import subprocess
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    piper, voice, out = sys.argv[1], sys.argv[2], sys.argv[3]
    # Piper's length scale: below 1 speaks faster (0.93 = about 7 % faster)
    length_scale = sys.argv[4] if len(sys.argv) > 4 else "1.0"
    os.makedirs(out, exist_ok=True)
    segments = json.load(open(os.path.join(ROOT, "tools", "narration.json"), encoding="utf-8"))
    durations = {}
    for seg in segments:
        path = os.path.join(out, seg["id"] + ".wav")
        subprocess.run([piper, "-m", voice, "-f", path, "--sentence-silence", "0.3", "--length-scale", length_scale],
                       input=seg["text"].encode("utf-8"), check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with wave.open(path) as w:
            durations[seg["id"]] = round(w.getnframes() / w.getframerate(), 3)
        print(seg["id"], durations[seg["id"]], "s")
    json.dump(durations, open(os.path.join(out, "durations.json"), "w"), indent=2)
    print("total", round(sum(durations.values()), 1), "s")


if __name__ == "__main__":
    main()
