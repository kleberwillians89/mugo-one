import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Bot, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { askIntelligence } from '../lib/records'

export function Intelligence({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const suggestions = ['Como estão as vendas deste mês?', 'Quanto ainda está aguardando?', 'Quais entregas estão atrasadas?', 'Quais perfumes estão acabando?', 'O que devo repor primeiro?', 'Existem vendas sem estoque suficiente?']
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState<Record<string,unknown>|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const [lastQuestion,setLastQuestion]=useState(''),[meta,setMeta]=useState<{run_id:string;status:string;retried:boolean;duration_ms:number}|null>(null)
  const [waitingMessage,setWaitingMessage]=useState('')
  const requestActive=useRef(false)
  const analysisRef=useRef<HTMLDivElement>(null),inputRef=useRef<HTMLTextAreaElement>(null)
  useEffect(()=>{if(!loading)return;const messages=['Consultando as vendas…','Conferindo pagamentos e clientes…','Organizando as informações…','Preparando um resumo simples…'];let index=0;const interval=window.setInterval(()=>{index+=1;setWaitingMessage(index>=4?'Estamos finalizando sua análise. Só mais um instante.':messages[index])},4000);return()=>window.clearInterval(interval)},[loading])
  useEffect(()=>{if(answer)window.setTimeout(()=>analysisRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),80)},[answer])
  const submit=async(text=question)=>{const clean=text.trim();if(!clean||requestActive.current)return;requestActive.current=true;setQuestion(clean);setLastQuestion(clean);setWaitingMessage('Consultando as vendas…');setLoading(true);setError('');setMeta(null);try{const result=await askIntelligence(clean,period);setAnswer(result.answer);setMeta(result.meta);setQuestion('')}catch(err){setError(err instanceof Error?err.message:'A inteligência está indisponível.')}finally{requestActive.current=false;setWaitingMessage('');setLoading(false)}}
  const renderList=(value:unknown)=>Array.isArray(value)?<ul>{value.map((item,index)=><li key={index}>{String(item)}</li>)}</ul>:<p>{String(value??'')}</p>
  const numbers=Array.isArray(answer?.numeros_principais)?answer.numeros_principais as {rotulo:string;valor:string;explicacao:string}[]:[]
  return <div className="page intelligence-page"><div className="page-lead"><div><h2>RUAH Intelligence</h2><p>Análise consultiva baseada apenas em agregados reais.</p></div><PeriodFilter value={period} onApply={setPeriod}/></div>
    <div className="intelligence-hero"><div className="hero-spark"><Sparkles/></div><span>RUAH INTELLIGENCE</span><h2>Decisões mais claras começam<br/>com as perguntas certas.</h2><p>Respostas baseadas exclusivamente nos dados autorizados da sua operação.</p></div>
    <div className="chat-box card">
      {!answer&&!loading?<div className="chat-empty"><Bot/><h3>Como posso ajudar hoje?</h3><p>Escolha uma sugestão ou escreva uma pergunta sobre os dados da RUAH.</p></div>:null}
      {loading&&<div className="ai-waiting" aria-live="polite"><LoaderCircle className="spin"/><div><strong>Estamos analisando os dados da RUAH.</strong><p>Isso pode levar alguns segundos.</p><span>{waitingMessage}</span></div></div>}
      {answer&&!loading&&<div className="ai-answer" ref={analysisRef}><div className="ai-question"><span>Sua pergunta</span><p>{lastQuestion}</p></div><span>Período: {String(answer.periodo_analisado??period.label)}</span><section className="ai-direct"><h4>Resposta direta</h4><h3>{String(answer.resumo??'Análise concluída')}</h3></section>{numbers.length>0&&<section><h4>Números principais</h4><div className="ai-metric-grid">{numbers.map((number,index)=><article key={index}><span>{number.rotulo}</span><strong>{number.valor}</strong><p>{number.explicacao}</p></article>)}</div></section>}{Array.isArray(answer.alertas)&&answer.alertas.length>0&&<section><h4>O que merece atenção</h4>{renderList(answer.alertas)}</section>}{Array.isArray(answer.recomendacoes)&&answer.recomendacoes.length>0&&<section><h4>Recomendações</h4>{renderList(answer.recomendacoes)}</section>}{Array.isArray(answer.proximas_acoes)&&answer.proximas_acoes.length>0&&<section><h4>Próximos passos</h4>{renderList(answer.proximas_acoes)}</section>}{meta&&<small>Análise concluída em {Math.round(meta.duration_ms/1000)} segundos</small>}<button className="ask-again" onClick={()=>{setAnswer(null);setLastQuestion('');window.setTimeout(()=>inputRef.current?.focus(),50)}}>Fazer outra pergunta</button></div>}
      {!answer&&!loading&&<div className="suggestions">{suggestions.map(x=><button key={x} onClick={()=>{setQuestion(x);submit(x)}}>{x}<ArrowUpRight size={14}/></button>)}</div>}
      <div className="chat-input"><textarea ref={inputRef} value={question} onChange={(event)=>setQuestion(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submit()}}} maxLength={1000} rows={2} placeholder="Pergunte sobre faturamento, clientes, pagamentos…" disabled={loading}/><button aria-label="Enviar pergunta" title="Enviar pergunta" disabled={loading||!question.trim()} onClick={()=>submit()}>{loading?<><LoaderCircle className="spin"/><span>Analisando…</span></>:<><ArrowUpRight/><span>Enviar</span></>}</button></div>
      {error&&<div className="ai-error"><div className="form-error">{error}</div><button onClick={()=>submit(lastQuestion)} disabled={loading}><RotateCcw/> Tentar novamente</button></div>}
      <small><span className="dot"/> A IA só acessa métricas agregadas e autorizadas</small>
    </div>
  </div>
}
