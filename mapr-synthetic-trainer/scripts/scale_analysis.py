# Analysis behind SCALE-RESULTS.md:
#   python3 scripts/scale_analysis.py output-scale C,D,E
# Reads <dir>/batch-*-results.json and <dir>/events.jsonl (lab snapshots),
# writes <dir>/scale-analysis.json and prints the numbers.
import json, sys, statistics as st, collections
D = sys.argv[1]; BATCHES = sys.argv[2].split(','); KEY = 'mapr_signed_w0.2'
def ms(v):
    v=[x for x in v if x is not None]
    return (st.mean(v), st.stdev(v) if len(v)>1 else 0.0) if v else (None,None)
P=lambda x: '-' if x is None else f'{x*100:.1f}%'
out = {}
labs = collections.defaultdict(list)
for l in open(f'{D}/events.jsonl'):
    e=json.loads(l)
    if e['type']=='lab': labs[e['job']['id']].append(e['lab'])
for b in BATCHES:
    rs=json.load(open(f'{D}/batch-{b}-results.json'))['simulations']
    R={}
    R['users']=rs[0]['users']; R['n']=len(rs)
    R['interactions']=rs[0]['interactions']
    for k in [KEY,'tag_sim','ncf','popularity','oracle']:
        R[k]={m: ms([r['rankers'][k][m] for r in rs]) for m in ['accuracy','heldout_ndcg_10','ndcg_10','recall_10','map_10','hit_rate_10']}
    d=[r['rankers'][KEY]['accuracy']-r['rankers']['tag_sim']['accuracy'] for r in rs]
    R['margin']=ms(d); R['margin_min']=min(d); R['margin_max']=max(d); R['wins']=sum(x>0 for x in d)
    R['cold']={k: ms([r['cold'][k]['accuracy'] for r in rs]) for k in [KEY,'tag_sim','ncf','popularity']}
    R['cold_wins']=sum(r['cold'][KEY]['accuracy']>r['cold']['tag_sim']['accuracy'] for r in rs)
    R['ncf_min']=ms([r['ncf']['ms']/60000 for r in rs]); R['epochs']=ms([r['ncf']['epochs_run'] for r in rs]); R['best_epoch']=ms([r['ncf']['best_epoch'] for r in rs])
    R['total_min']=ms([r['timing']['total_ms']/60000 for r in rs])
    R['stopped']=collections.Counter(r['ncf']['stopped_by'] for r in rs)
    # reveals
    R['reveals']={}
    for k in rs[0]['extended']['reveals']:
        bl=[r['extended']['reveals'][k][KEY]['accuracy'] for r in rs]; tg=[r['extended']['reveals'][k]['tag_sim']['accuracy'] for r in rs]
        R['reveals'][k]=(st.mean(bl), st.mean(tg), sum(x>y for x,y in zip(bl,tg)))
    # diversity
    div={}
    for kk in [KEY,'tag_sim']:
        t=collections.Counter()
        for r in rs:
            for f,v in r['extended']['diversity'][kk].items(): t[f]+=v
        div[kk]={f: t[f]/t['users'] for f in ['categories','kinds','local','outside_history']}
    R['diversity']=div
    ag=collections.Counter()
    for r in rs:
        for f,v in r['extended']['agreement'].items(): ag[f]+=v
    R['agreement']=dict(ag)
    conf=[[0,0] for _ in range(4)]
    for r in rs:
        for i,c in enumerate(r['extended']['confidence']): conf[i][0]+=c['pairs']; conf[i][1]+=c['right']
    R['confidence']=conf
    reg=collections.defaultdict(lambda: collections.defaultdict(lambda:[0,0]))
    for r in rs:
        for city,m in r['extended']['regions'].items():
            for kk,v in m.items():
                reg[city][kk][0]+=v['accuracy']*v['pairs']; reg[city][kk][1]+=v['pairs']
    R['regions']={c:{kk:(v[0]/v[1] if v[1] else None, v[1]) for kk,v in m.items()} for c,m in reg.items()}
    # archetypes pooled
    arc=collections.defaultdict(lambda: {'b':[0,0],'t':[0,0],'u':0})
    for r in rs:
        for name,a in r['archetypes'].items():
            if KEY not in a or not a[KEY]['pairs']: continue
            arc[name]['b'][0]+=a[KEY]['accuracy']*a[KEY]['pairs']; arc[name]['b'][1]+=a[KEY]['pairs']
            arc[name]['t'][0]+=a['tag_sim']['accuracy']*a['tag_sim']['pairs']; arc[name]['t'][1]+=a['tag_sim']['pairs']
            arc[name]['u']+=a['users']
    R['archetypes']=sorted([(n, v['b'][0]/v['b'][1], v['t'][0]/v['t'][1], v['u']) for n,v in arc.items() if v['b'][1]>=100], key=lambda x:-x[1])
    # convergence from lab events
    conv=[]
    for r in rs:
        L=sorted(labs.get(f"{b}{r['sim']}",[]), key=lambda x:x['epoch'])
        if not L: continue
        first=lambda th: next((x['epoch'] for x in L if x['mapr_accuracy']>=th), None)
        beat=next((x['epoch'] for x in L if x['mapr_accuracy']>x['base_accuracy']), None)
        best=max(x['mapr_accuracy'] for x in L)
        nfirst=lambda th: next((x['epoch'] for x in L if x['ncf_accuracy']>=th), None)
        conv.append({'n55':nfirst(.55),'n60':nfirst(.60),'n65':nfirst(.65),'ncf_final':L[-1]['ncf_accuracy'],'e70':first(.70),'e75':first(.75),'e80':first(.80),'beat':beat,'start':L[0]['mapr_accuracy'],'base':L[0]['base_accuracy'],'best':best,'final':L[-1]['mapr_accuracy'],'ms':r['ncf']['ms']})
    R['conv']=conv
    out[b]=R
json.dump(out, open(f'{D}/scale-analysis.json','w'), indent=1, default=str)
for b,R in out.items():
    print(f"== {b} {R['users']} users ({R['n']} sims): blend {P(R[KEY]['accuracy'][0])} sd {P(R[KEY]['accuracy'][1])} | tag+sim {P(R['tag_sim']['accuracy'][0])} | margin {R['margin'][0]*100:+.2f} (min {R['margin_min']*100:+.2f}, max {R['margin_max']*100:+.2f}) wins {R['wins']}/{R['n']}")
    print(f"   NCF alone {P(R['ncf']['accuracy'][0])} | heldout NDCG blend {R[KEY]['heldout_ndcg_10'][0]:.3f} tag {R['tag_sim']['heldout_ndcg_10'][0]:.3f} | catalog NDCG blend {R[KEY]['ndcg_10'][0]:.4f} tag {R['tag_sim']['ndcg_10'][0]:.4f} | recall blend {R[KEY]['recall_10'][0]:.4f} tag {R['tag_sim']['recall_10'][0]:.4f}")
    print(f"   cold blend {P(R['cold'][KEY][0])} today {P(R['cold']['tag_sim'][0])} wins {R['cold_wins']} | reveals {[(k, round(v[0]*100,1), round(v[1]*100,1), v[2]) for k,v in R['reveals'].items()]}")
    print(f"   train {R['ncf_min'][0]:.1f} min, epochs {R['epochs'][0]:.1f}, best {R['best_epoch'][0]:.1f}, total {R['total_min'][0]:.1f} min, stopped {dict(R['stopped'])}")
    print(f"   diversity {R['diversity']} | agreement {R['agreement']} | conf {R['confidence']}")
    regs = ', '.join(c + ': ' + P(m[KEY][0]) + ' vs ' + P(m['tag_sim'][0]) for c, m in R['regions'].items())
    print('   regions ' + regs)
    print(f"   top5 {[(a[0], round(a[1]*100,1)) for a in R['archetypes'][:5]]}")
    print(f"   bottom5 {[(a[0], round(a[1]*100,1), round(a[2]*100,1)) for a in R['archetypes'][-5:]]}")
    c=R['conv']
    if c: print(f"   conv: start {st.mean(x['start'] for x in c)*100:.1f} base {st.mean(x['base'] for x in c)*100:.1f} best {st.mean(x['best'] for x in c)*100:.1f} | e70 {[x['e70'] for x in c]} e75 {[x['e75'] for x in c]} e80 {[x['e80'] for x in c]} beat {[x['beat'] for x in c]}")
    if c: print(f"   ncf-alone conv: n55 {[x['n55'] for x in c]} n60 {[x['n60'] for x in c]} n65 {[x['n65'] for x in c]} final {st.mean(x['ncf_final'] for x in c)*100:.1f}")
