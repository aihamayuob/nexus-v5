#!/usr/bin/env python3
# CP-19 mutation runner (scratch, NOT part of the repository). Each mutant = exactly-once anchored text replacement(s)
# applied to a scratch COPY of frontend/ inside the isolated repo copy. Anchor count != 1 -> ANCHOR-ERROR (exit 2 for that mutant).
import os, re, shutil, subprocess, sys, json
S='/tmp/claude-0/-home-claude/ab9ed084-7608-5722-8dc1-06ac77002352/scratchpad/CP19'
ISO=S+'/iso/nexus-v5'
HTML='neural_nexus_ai_agents-4-3-5-3.html'
SRC=ISO+'/frontend'
WORK=S+'/mut/work'
LOGS=S+'/mut/logs'
os.makedirs(WORK,exist_ok=True); os.makedirs(LOGS,exist_ok=True)

TIME_LINE = "ctx += `\\n\\n[السياق الزمني: الآن ${this.now()}]`;"
KNOW_LINE = "ctx += await NexusContext._safe('agent knowledge', () => agentKnowledgeContext(agent, queryText));"
GATE = "const wantsMemoryAndFiles = intent.requiredEvidence || intent.complexity !== 'low' || intent.freshness !== 'static';"
FILE_FENCE = "ctx += PromptInjectionGuard.fence('مستند مرفوع', fileCtx.replace(/^\\n\\n/, ''));"
MKT_FENCE = "ctx += PromptInjectionGuard.fence('بيانات سوقية', marketCtx.replace(/^\\n\\n/, ''));"
MEM_LINE = "ctx += await NexusContext._safe('long-term memory', () => retrieveLongTermMemoryContext(queryText));"
FILE_LINE = "const fileCtx = await NexusContext._safe('uploaded documents', () => fileDocsContext(queryText));"
MKT_COND = "if(agent.id === 'financial' && (intent.freshness !== 'static' || intent.domain === 'business')){"
SAFE_BLOCK = "    try{ return await fn(); }\n    catch(e){ console.error('NexusContext: ' + label + ' failed (non-fatal):', e.message); return ''; }"
SAFE_CATCH = "console.error('NexusContext: ' + label + ' failed (non-fatal):', e.message); return ''; }"

M = {
 'MU01':[(SAFE_BLOCK,"    return await fn();")],
 'MU02':[(SAFE_CATCH,"console.error('NexusContext: ' + label + ' failed (non-fatal):', e.message); return undefined; }")],
 'MU03':[(SAFE_CATCH,"return ''; }")],
 'MU04':[(GATE,"const wantsMemoryAndFiles = true;")],
 'MU05':[(GATE,"const wantsMemoryAndFiles = false;")],
 'MU06':[(GATE,"const wantsMemoryAndFiles = intent.requiredEvidence || intent.freshness !== 'static';")],
 'MU07':[(GATE,"const wantsMemoryAndFiles = intent.complexity !== 'low' || intent.freshness !== 'static';")],
 'MU08':[(GATE,"const wantsMemoryAndFiles = intent.requiredEvidence || intent.complexity !== 'low';")],
 'MU09':[(KNOW_LINE,"if(intent.requiredEvidence || intent.complexity !== 'low' || intent.freshness !== 'static') "+KNOW_LINE)],
 'MU10':[(TIME_LINE,"")],
 'MU11':[(TIME_LINE,""),(KNOW_LINE,KNOW_LINE+"\n    "+TIME_LINE)],
 'MU12':[(FILE_FENCE,"ctx += fileCtx.replace(/^\\n\\n/, '');")],
 'MU13':[(MKT_FENCE,"ctx += marketCtx.replace(/^\\n\\n/, '');")],
 'MU14':[(MKT_COND,"if((intent.freshness !== 'static' || intent.domain === 'business')){")],
 'MU15':[(MKT_COND,"if(agent.id === 'financial' && (intent.freshness !== 'static')){")],
 'MU16':[(MKT_COND,"if(agent.id === 'financial' && (intent.domain === 'business')){")],
 'MU17':[(".filter(s => s.score > 0.72)\n      .slice(0, topK);\n    if(scored.length === 0) return '';",".filter(s => s.score > 0.5)\n      .slice(0, topK);\n    if(scored.length === 0) return '';")],
 'MU18':[("async function retrieveLongTermMemoryContext(queryText, topK=3){","async function retrieveLongTermMemoryContext(queryText, topK=2){")],
 'MU19':[("return agent.prompt + built.text;","return built.text + agent.prompt;")],
 'MU20':[("const routed = await routeEntries(queryText, allChunks, 3);","const routed = await routeEntries(queryText, allChunks, 1);")],
 'MU21':[("if(opts.taskId){","if(false && opts.taskId){")],
 'MU22':[("return { text: ctx, intent };","return { text: ctx };")],
 'MU23':[("catch(e){ return new Date().toISOString(); }","catch(e){ return ''; }")],
 'MU24':[("if(agent.id === 'financial'){\n      ctx += await this._safe('market context', () => getMarketContext());","if(false){\n      ctx += await this._safe('market context', () => getMarketContext());")],
 'MU25':[("      "+MEM_LINE+"\n      "+FILE_LINE+"\n      "+FILE_FENCE, "      "+FILE_LINE+"\n      "+FILE_FENCE+"\n      "+MEM_LINE)],
 'MU26':[(KNOW_LINE,KNOW_LINE.replace("'agent knowledge'","'agent-knowledge'"))],
}
only = sys.argv[1:] 
ids = only if only else ['CTRL']+sorted(M)
summary={}
for mid in ids:
    d=f'{WORK}/{mid}'
    shutil.rmtree(d,ignore_errors=True)
    shutil.copytree(SRC,d+'/frontend')
    status='RUN'
    if mid!='CTRL':
        p=d+'/frontend/'+HTML
        s=open(p,encoding='utf-8').read()
        orig=s
        for a,b in M[mid]:
            c=s.count(a)
            if c!=1:
                status=f'ANCHOR-ERROR(count={c})'; print(mid,status); break
            s=s.replace(a,b)
        if status=='RUN':
            open(p,'w',encoding='utf-8').write(s)
            open(f'{LOGS}/{mid}.diff','w').write(subprocess.run(['diff','-u',SRC+'/'+HTML,p],capture_output=True,text=True).stdout)
    if status!='RUN':
        summary[mid]={'status':status}; continue
    env=dict(os.environ,NEXUS_FRONTEND_DIR=d+'/frontend',NEXUS_S11_RESULTS=f'{LOGS}/{mid}-results.json')
    r=subprocess.run(['node','phase2-core-slice11-context-characterization-flows.mjs'],cwd=ISO+'/e2e',env=env,capture_output=True,text=True,timeout=300)
    open(f'{LOGS}/{mid}.log','w').write(r.stdout+r.stderr)
    verdict=re.findall(r'S11-VERDICT = (\w+)',r.stdout)
    fails=re.findall(r'^\[FAIL\] \[(\w+)\] (\S+)',r.stdout,re.M)
    summary[mid]={'exit':r.returncode,'verdict':verdict[-1] if verdict else None,'fails':[f'{k}:{n}' for k,n in fails]}
    print(mid,summary[mid]['verdict'],'exit',r.returncode,'FAIL:',', '.join(n.split('-')[0] for k,n in fails) or '-')
    shutil.rmtree(d,ignore_errors=True)
json.dump(summary,open(f'{LOGS}/summary-{"all" if not only else "_".join(only)}.json','w'),ensure_ascii=False,indent=1)
