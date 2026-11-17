"""Token usage per agent from session transcripts.

Usage: python3 scripts/token-usage.py [YYYY-MM-DD]   (default: last 7 days)
Cost-equiv weights: input 1, 1h cache write 2, 5m cache write 1.25, cache read 0.1, output 5.
"""
import json,os,collections,re,sys,datetime
since=sys.argv[1] if len(sys.argv)>1 else (datetime.date.today()-datetime.timedelta(days=7)).isoformat()
print("since",since)
names={"9dkz61":"Sophia","b107a0":"Kids","e5zem8":"Term"}
agg=collections.defaultdict(collections.Counter); files=collections.defaultdict(collections.Counter); seen=set()
tools=collections.defaultdict(collections.Counter)
ctx=collections.defaultdict(list)
for root,ds,fs in os.walk("data/v2-sessions"):
    for fn in fs:
        if ".jsonl" not in fn: continue
        f=os.path.join(root,fn)
        m=re.search(r"ag-[^/]*?([a-z0-9]{6})/",f); ag=names.get(m.group(1),"?") if m else "?"
        sub="sub" if "subagents" in f else "main"
        for line in open(f,errors="ignore"):
            try: d=json.loads(line)
            except: continue
            if d.get("type")!="assistant": continue
            if d.get("timestamp","")[:10]<since: continue
            msg=d.get("message",{}); u=msg.get("usage")
            if not u or msg.get("model")=="<synthetic>": continue
            for b in msg.get("content",[]):
                if b.get("type")=="tool_use": tools[ag][b["name"]]+=1 if msg.get("id") not in seen else 0
            if msg.get("id") in seen: continue
            seen.add(msg.get("id"))
            cc=u.get("cache_creation",{}) or {}
            w1h=cc.get("ephemeral_1h_input_tokens",0); w5=cc.get("ephemeral_5m_input_tokens",0)
            i=u.get("input_tokens",0); cr=u.get("cache_read_input_tokens",0); o=u.get("output_tokens",0)
            for c in (agg[(ag,sub,msg.get("model"))], files[(ag,fn[:8],sub)]):
                c["req"]+=1; c["in"]+=i; c["w1h"]+=w1h; c["w5"]+=w5; c["cr"]+=cr; c["out"]+=o
                c["miss"]+= 1 if (cr==0 and (w1h+w5)>20000) else 0
            ctx[ag].append(i+w1h+w5+cr)
def eq(c): return c["in"]+2*c["w1h"]+1.25*c["w5"]+0.1*c["cr"]+5*c["out"]
print("agent/sub/model | reqs | uncached_in | write1h | write5m | cache_read | out | full-misses | cost-equiv(Mtok-in) | share in/write/read/out %")
for k,c in sorted(agg.items()):
    e=eq(c)
    print(k,c["req"],c["in"],c["w1h"],c["w5"],c["cr"],c["out"],c["miss"],round(e/1e6,2),
      [round(100*x/e) for x in (c["in"],2*c["w1h"]+1.25*c["w5"],0.1*c["cr"],5*c["out"])])
for ag,v in ctx.items():
    v.sort(); print(ag,"ctx per request: median",v[len(v)//2],"p90",v[int(len(v)*.9)],"max",v[-1],"min",v[0])
for ag in tools: print(ag,tools[ag].most_common(14))
print("top transcripts by cost-equiv")
for k,c in sorted(files.items(),key=lambda kv:-eq(kv[1]))[:12]: print(k,c["req"],round(eq(c)/1e6,2),"miss",c["miss"])
