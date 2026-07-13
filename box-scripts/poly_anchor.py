#!/usr/bin/env python3
# Anchor the on-chain OrderFilled decoder: take a KNOWN France-market fill, pull its
# receipt, find the CTF-Exchange log, print topic0 + decode the data words, and confirm
# one asset id == our market token. Validates topic0 + layout before building the pager.
import json, subprocess, os
RPC = open(os.path.expanduser("~/.poly_rpc")).read().strip()
COND = "0xad3441638abca4aa830cb997b7caea5f3c8b84be06b99173781cb9a47c5cbc5a"
CTF  = "0xe111180000d2663c0091e4f400237545b87b996b"   # CTF Exchange V2 (lowercase)
YES  = 113891226639705983282066963484423345278150974279743795316461155085208879415201
NO   = 21768823063425705834344898922772041926865204761442619231134822499901743767561
UA   = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36"

def curl(url, *args):
    return subprocess.run(["curl","-s","--max-time","30",*args,url], capture_output=True, text=True).stdout
def rpc(method, params):
    body = json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params})
    return json.loads(curl(RPC, "-H","content-type: application/json","-d",body))

tr = json.loads(curl(f"https://data-api.polymarket.com/trades?market={COND}&limit=3&takerOnly=false","-H",f"User-Agent: {UA}"))
for t in tr[:1]:
    tx = t["transactionHash"]
    print(f"known fill: tx={tx}\n  ts={t['timestamp']} side={t['side']} price={t['price']} size={t['size']} outcome={t['outcome']}")
    rc = rpc("eth_getTransactionReceipt", [tx]).get("result")
    if not rc:
        print("  no receipt"); continue
    print(f"  block={int(rc['blockNumber'],16)}  total logs={len(rc['logs'])}")
    for j, lg in enumerate(rc["logs"]):
        data = lg["data"][2:]
        words = [data[i:i+64] for i in range(0, len(data), 64)]
        hit = any(int(w,16) in (YES,NO) for w in words) or any(int(tp,16) in (YES,NO) for tp in lg["topics"])
        print(f"  [{j}] addr={lg['address']}  topic0={lg['topics'][0][:18]}..  ntopics={len(lg['topics'])}  ndata={len(words)}{'   *** TOKEN MATCH ***' if hit else ''}")
        if hit:
            for i, w in enumerate(words):
                v = int(w,16); tag = " <=YES" if v==YES else (" <=NO" if v==NO else "")
                print(f"        data[{i}] {v}{tag}")
