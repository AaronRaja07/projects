"""Mission Control: original synthetic portfolio model, no external integrations."""
import csv
import io
import json
import math
from pathlib import Path
import random
import statistics
import threading

LOCK = threading.RLock()
STORE = Path(__file__).resolve().parent.parent / '.demo-state' / 'mission.json'
TEAMS = ['Platform', 'Experience', 'Intelligence', 'Reliability']
STATUSES = ['Ready', 'In progress', 'Blocked', 'Done']
CAPACITIES = dict(zip(TEAMS, [90, 78, 85, 72]))

def seeded():
    rng = random.Random(917)
    epics = [{'id': f'EP-{i+1:02}', 'title': title, 'team': TEAMS[i//2], 'outcome': out, 'depends_on': [f'EP-{i:02}'] if i in (2, 4, 6) else []} for i,(title,out) in enumerate([
        ('Unified event catalog','Make datasets discoverable'), ('Schema quality gates','Catch breaking changes'),
        ('Self-service onboarding','Reduce setup friction'), ('Workspace navigation','Improve task completion'),
        ('Demand signals','Improve planning accuracy'), ('Decision explanations','Make recommendations auditable'),
        ('Incident response','Reduce recovery effort'), ('Service readiness','Make releases observable')])]
    tickets=[]
    for i in range(144):
        epic=epics[i%8]; sprint=['S-01','S-02','S-03'][i//48]
        status=rng.choices(STATUSES,weights=[10,12,5,73] if sprint!='S-03' else [20,36,14,30])[0]
        pts=rng.choice([1,2,3,5,8,13])
        tickets.append({'id':f'WK-{i+1:03}','title':rng.choice(['Implement','Validate','Instrument','Review'])+' '+epic['title'].lower()+f' / task {i//8+1}', 'team':epic['team'],'epic':epic['id'],'sprint':sprint,'points':pts,'status':status,'owner':f'Contributor {i%12+1:02}', 'description':rng.random()>.10,'acceptance':rng.random()>.17,'estimated':rng.random()>.06,'age_days':rng.randint(1,18),'cycle_days':rng.randint(2,10),'priority':rng.choice(['High','Medium','Low'])})
    return {'tickets':tickets,'epics':epics,'capacity':CAPACITIES.copy(),'reviews':[{'id':'RV-01','date':'2026-10-20','team':'Platform','topic':'Catalog readiness review','facilitator':'Demo facilitator A','status':'Scheduled'},{'id':'RV-02','date':'2026-10-22','team':'Experience','topic':'Onboarding experiment readout','facilitator':'Demo facilitator B','status':'Scheduled'}], 'baseline':{e['id']:sum(t['points'] for t in tickets if t['epic']==e['id']) for e in epics},'audit':[]}

def load():
    if STORE.exists():
        return json.loads(STORE.read_text())
    return seeded()

def save(data):
    STORE.parent.mkdir(exist_ok=True)
    temp=STORE.with_suffix('.tmp');temp.write_text(json.dumps(data,indent=2));temp.replace(STORE)

def scoped(data,query):
    team=query.get('team',['All'])[0];sprint=query.get('sprint',['S-03'])[0]
    status=query.get('status',['All'])[0];search=str(query.get('q',[''])[0]).strip().lower()
    if team not in TEAMS+['All'] or sprint not in ['All','S-01','S-02','S-03'] or status not in STATUSES+['All','Remaining']:
        raise ValueError('Unknown filter')
    return [t for t in data['tickets'] if (team=='All' or t['team']==team) and (sprint=='All' or t['sprint']==sprint)
            and (status=='All' or (status=='Remaining' and t['status']!='Done') or t['status']==status)
            and (not search or search in ' '.join(str(t[k]) for k in ['id','title','team','owner','epic']).lower())]

def metrics(tickets):
    pts=sum(t['points'] for t in tickets);done=sum(t['points'] for t in tickets if t['status']=='Done')
    gaps=[t for t in tickets if not all((t['description'],t['acceptance'],t['estimated']))]
    return {'tickets':len(tickets),'points':pts,'done':done,'completion':round(100*done/pts,1) if pts else 0,'blocked':sum(t['status']=='Blocked' for t in tickets),'hygiene':round(100*(len(tickets)-len(gaps))/len(tickets),1) if tickets else 100,'gaps':len(gaps)}

def overview(data,query):
    tickets=scoped(data,query); teams=TEAMS if query.get('team',['All'])[0]=='All' else query['team']
    m=metrics(tickets)
    # All aggregations sum stories exactly once; epics are references, never extra work.
    capacity=[]
    for team in teams:
        current=[t for t in tickets if t['team']==team]; mt=metrics(current)
        sprint_count=3 if query.get('sprint',['S-03'])[0]=='All' else 1
        cap=data['capacity'][team]*sprint_count
        capacity.append({'team':team,**mt,'capacity':cap,'utilization':round(mt['points']/cap*100,1)})
    epics=[]
    for e in data['epics']:
        ts=[t for t in tickets if t['epic']==e['id']]
        if ts:epics.append({**e,**metrics(ts),'current_total':sum(t['points'] for t in data['tickets'] if t['epic']==e['id']),'baseline':data['baseline'].get(e['id'],0)})
    histories=[{'sprint':s,**metrics([t for t in data['tickets'] if t['sprint']==s and t['team'] in teams])} for s in ['S-01','S-02','S-03']]
    # Monotone demo trajectory anchored to observed remaining scope; not historical telemetry.
    remaining=m['points']-m['done'];actual=[round(m['points']-(m['done']*day/7)) for day in range(8)]+[None]*3
    ideal=[round(m['points']*(1-day/10)) for day in range(11)]
    risk=[]
    if m['blocked']:risk.append({'kind':'Blockers','title':f"{m['blocked']} work items need an unblock decision",'detail':'Inspect blocked age, the owning team, and upstream epic dependencies.'})
    for c in capacity:
        if c['utilization']>100:risk.append({'kind':'Capacity','title':c['team']+' is over the planning envelope','detail':f"{c['points']} points committed against {c['capacity']} of modeled capacity. Re-scope before adding work."})
    if m['gaps']:risk.append({'kind':'Readiness','title':f"{m['gaps']} items have quality gaps",'detail':'Missing acceptance criteria, descriptions, or estimates make commitment less reliable.'})
    contributors=[]
    for owner in sorted(set(t['owner'] for t in tickets)):
        ts=[t for t in tickets if t['owner']==owner];contributors.append({'owner':owner,**metrics(ts)})
    return {'synthetic':True,'as_of':'2026-10-14','metrics':m,'capacity':capacity,'tickets':tickets,'epics':epics,'history':histories,'burndown':{'ideal':ideal,'actual':actual[:8]},'risks':risk,'contributors':contributors,'reviews':data['reviews'],'audit':data['audit'][-15:],'baseline':data['baseline']}

def forecast(data,body):
    team=body.get('team','All');q={'team':[team],'sprint':['S-03']};ts=scoped(data,q)
    staffing=float(body.get('staffing',1));added=float(body.get('scope',0));trials=int(body.get('trials',2000))
    if not math.isfinite(staffing) or not .25<=staffing<=2 or not math.isfinite(added) or not 0<=added<=200 or not 100<=trials<=10000:raise ValueError('Scenario values out of range')
    past=[[t for t in data['tickets'] if t['sprint']==s and (team=='All' or t['team']==team)] for s in ['S-01','S-02']]
    velocity=[metrics(t)['done'] for t in past]
    remaining=metrics(ts)['points']-metrics(ts)['done']+added
    rng=random.Random(33);samples=[]
    for _ in range(trials):
        daily=max(.1,rng.choice(velocity)/10*staffing*rng.uniform(.7,1.3));samples.append(math.ceil(remaining/daily))
    samples.sort()
    def pct(p):return samples[min(len(samples)-1, math.ceil(p*len(samples))-1)]
    bins=[{'days':0,'count':sum(x==0 for x in samples)}]+[{'days':d,'count':sum(d-2<x<=d for x in samples)} for d in range(2,max(samples)+2,2)]
    return {'synthetic':True,'remaining':remaining,'velocity':velocity,'p50':pct(.5),'p80':pct(.8),'p95':pct(.95),'within_10_days':round(100*sum(x<=10 for x in samples)/trials,1),'histogram':bins,'trials':trials,'assumptions':['Completed points from two synthetic sprints, resampled with uniform 0.7–1.3 variation.','10 working days per sprint; staffing scales throughput linearly.','Illustrative model only: short history and dependencies limit predictive validity.']}

def handle(method,path,query,body):
    with LOCK:
        data=load()
        if method=='GET' and path in ['/overview','/']:
            return overview(data,query)
        if method=='POST' and path=='/forecast':return forecast(data,body)
        if method=='GET' and path=='/dependencies':return dependencies(data,query)
        if method=='POST' and path=='/capacity':
            team=body.get('team');value=int(body.get('capacity',0))
            if team not in TEAMS or not 1<=value<=500:raise ValueError('Choose a valid team and capacity 1–500')
            data['capacity'][team]=value; data['audit'].append({'action':'Capacity updated','detail':f'{team}: {value} points'})
        elif method=='POST' and path=='/ticket':
            ticket=next((t for t in data['tickets'] if t['id']==body.get('id')),None)
            if not ticket or body.get('status') not in STATUSES:raise ValueError('Valid ticket and status required')
            ticket['status']=body['status']; data['audit'].append({'action':'Status updated','detail':ticket['id']+' → '+ticket['status']})
        elif method=='POST' and path=='/hygiene':
            ticket=next((t for t in data['tickets'] if t['id']==body.get('id')),None)
            if not ticket:raise ValueError('Ticket not found')
            ticket.update(description=True, acceptance=True, estimated=True)
            data['audit'].append({'action':'Demo readiness filled','detail':ticket['id']})
        elif method=='POST' and path=='/baseline':
            data['baseline']={e['id']:sum(t['points'] for t in data['tickets'] if t['epic']==e['id']) for e in data['epics']};data['audit'].append({'action':'Baseline saved','detail':'All epic story-point totals captured'})
        elif method=='POST' and path=='/scope':
            points=int(body.get('points',5));epic=next((e for e in data['epics'] if e['id']==body.get('epic')),None)
            if not epic or not 1<=points<=21:raise ValueError('Valid epic and 1–21 points required')
            ix=max(int(t['id'].split('-')[1]) for t in data['tickets'])+1
            data['tickets'].append({'id':f'WK-{ix:03}','title':'Synthetic scope addition','team':epic['team'],'epic':epic['id'],'sprint':'S-03','points':points,'status':'Ready','owner':'Contributor 01','description':True,'acceptance':True,'estimated':True,'age_days':0,'cycle_days':0,'priority':'High'})
            data['audit'].append({'action':'Scope added','detail':epic['id']+f': +{points} points'})
        elif method=='POST' and path=='/review':
            import datetime
            date=str(body.get('date',''));datetime.date.fromisoformat(date)
            team=body.get('team');topic=str(body.get('topic','')).strip();facilitator=str(body.get('facilitator','Demo facilitator')).strip()
            if team not in TEAMS or not 1<=len(topic)<=120 or not 1<=len(facilitator)<=80:raise ValueError('Valid team, topic, and facilitator required')
            rid=body.get('id');existing=next((r for r in data['reviews'] if r['id']==rid),None)
            if rid and not existing:raise ValueError('Review not found')
            row={'id':rid or 'RV-'+str(max([int(r['id'].split('-')[1]) for r in data['reviews']]+[0])+1).zfill(2),'date':date,'team':team,'topic':topic,'facilitator':facilitator,'status':'Scheduled'}
            if existing: data['reviews'][data['reviews'].index(existing)]=row
            else:data['reviews'].append(row)
            data['audit'].append({'action':'Review saved','detail':row['id']})
        elif method=='POST' and path=='/review/delete':
            data['reviews']=[r for r in data['reviews'] if r['id']!=body.get('id')]
        elif method=='POST' and path=='/reset':data=seeded()
        elif method=='GET' and path=='/report':
            o=overview(data,query);m=o['metrics'];out=io.StringIO();writer=csv.DictWriter(out,fieldnames=['id','title','team','epic','sprint','points','status','owner']);writer.writeheader();writer.writerows({k:t[k] for k in writer.fieldnames} for t in o['tickets'])
            return {'markdown':f"# Mission Control · synthetic delivery readout\n\nSnapshot: 2026-10-14 (fixed demo date)\n\n{m['tickets']} stories; {m['done']}/{m['points']} points complete ({m['completion']}%).\n{m['blocked']} blockers; readiness {m['hygiene']}%.\n\n## Decisions\n"+'\n'.join('- '+r['title']+': '+r['detail'] for r in o['risks'])+'\n\nAll records are generated. No production outcomes or customer adoption are claimed.\n','csv':out.getvalue()}
        else:raise ValueError('Unknown endpoint')
        save(data);return {'ok':True}


def dependencies(data, query):
    tickets=scoped(data,query)
    # Filters select target outcomes; prerequisites retain their whole sprint scope.
    dependency_work=scoped(data,{'team':['All'],'sprint':query.get('sprint',['S-03'])})
    selected={t['epic'] for t in tickets}
    by_id={e['id']:e for e in data['epics']}
    nodes={};visiting=set()
    def visit(key):
        if key in nodes:return nodes[key]
        if key in visiting:raise ValueError('Dependency cycle detected')
        if key not in by_id:raise ValueError('Missing dependency')
        visiting.add(key);epic=by_id[key]
        work=[t for t in dependency_work if t['epic']==key]
        duration=math.ceil((metrics(work)['points']-metrics(work)['done'])/max(1,data['capacity'][epic['team']]/10))
        upstream=[visit(k) for k in epic['depends_on']]
        latest=max(upstream,key=lambda x:x['finish']) if upstream else None
        start=latest['finish'] if latest else 0
        node={'id':key,'title':epic['title'],'duration':duration,'start':start,'finish':start+duration,'path':(latest['path'] if latest else [])+[key]}
        visiting.remove(key);nodes[key]=node;return node
    for key in sorted(selected):visit(key)
    last=max(nodes.values(),key=lambda x:x['finish']) if nodes else {'finish':0,'path':[]}
    return {'nodes':list(nodes.values()),'critical_path':last['path'],'total_days':last['finish'],'synthetic':True}
