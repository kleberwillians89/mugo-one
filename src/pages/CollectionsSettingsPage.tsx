import{useEffect,useState}from'react'
import{PageHeader,PrimaryButton,SecondaryButton,StatusBadge,useToast}from'../components/ui'
import{SettingsTabs}from'../components/SettingsTabs'
import{useHasPermission}from'../lib/PermissionsContext'
import{
 CollectionMessageChannel,CollectionMessageTemplate,CollectionTemplateInput,EMPTY_COLLECTION_SETTINGS,OrganizationCollectionSettings,PixKeyType,
 createCollectionMessageTemplate,deleteCollectionMessageTemplate,fetchCollectionMessageTemplates,fetchOrganizationCollectionSettings,
 previewCollectionTemplate,saveOrganizationCollectionSettings,seedDefaultCollectionTemplates,updateCollectionMessageTemplate,
}from'../lib/collections'
import'./TeamSettingsPage.css'

const PIX_KEY_TYPES:{value:PixKeyType;label:string}[]=[{value:'cpf',label:'CPF'},{value:'cnpj',label:'CNPJ'},{value:'email',label:'E-mail'},{value:'telefone',label:'Telefone'},{value:'aleatoria',label:'Aleatória'}]
const CHANNELS:{value:CollectionMessageChannel;label:string}[]=[{value:'generic',label:'Genérico'},{value:'email',label:'E-mail'},{value:'whatsapp',label:'WhatsApp'},{value:'sms',label:'SMS'}]
const VARIABLES=['customer.name','company.name','organization.name','sale.id','sale.total','collection.amount','collection.due_date','payment.pix_key','payment.pix_holder_name','payment.payment_link','support.phone','support.email']

const EMPTY_TEMPLATE:CollectionTemplateInput={name:'',key:'',channel:'generic',subject:'',body:'',active:true}

function SettingsSection(){
 const toast=useToast()
 const canConfigure=useHasPermission('collections.configure')
 const[settings,setSettings]=useState<OrganizationCollectionSettings>(EMPTY_COLLECTION_SETTINGS)
 const[loading,setLoading]=useState(true)
 const[saving,setSaving]=useState(false)
 useEffect(()=>{fetchOrganizationCollectionSettings().then(s=>{if(s)setSettings(s)}).catch(()=>{}).finally(()=>setLoading(false))},[])
 const save=async()=>{
  setSaving(true)
  try{setSettings(await saveOrganizationCollectionSettings(settings));toast.push('Configurações de cobrança salvas.',{tone:'success'})}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível salvar.',{tone:'error'})}
  finally{setSaving(false)}
 }
 if(loading)return<div className="card"><p>Carregando…</p></div>
 return<div className="card" style={{marginBottom:'var(--space-4)'}}>
  <div className="card-title"><div><h3>Identidade da cobrança</h3><p>Nome exibido e instruções gerais — CNPJ/Razão social já vêm de Configurações gerais.</p></div></div>
  <div className="form-grid">
   <label className="field"><span>Nome exibido nas cobranças</span><input value={settings.displayName} disabled={!canConfigure} onChange={e=>setSettings({...settings,displayName:e.target.value})}/></label>
   <label className="field"><span>Prazo padrão para vencimento (dias)</span><input type="number" min={0} max={365} value={settings.defaultDueDays} disabled={!canConfigure} onChange={e=>setSettings({...settings,defaultDueDays:Number(e.target.value)||0})}/></label>
  </div>
  <label className="field"><span>Instruções de pagamento</span><textarea rows={2} value={settings.paymentInstructions} disabled={!canConfigure} onChange={e=>setSettings({...settings,paymentInstructions:e.target.value})}/></label>

  <div className="card-title" style={{marginTop:'var(--space-3)'}}><div><h3>PIX</h3><p>Opcional — desabilitado por padrão até a organização configurar uma chave.</p></div>
   <StatusBadge tone={settings.pixEnabled?'success':'neutral'}>{settings.pixEnabled?'HABILITADO':'DESABILITADO'}</StatusBadge>
  </div>
  <label><input type="checkbox" checked={settings.pixEnabled} disabled={!canConfigure} onChange={e=>setSettings({...settings,pixEnabled:e.target.checked})}/> Habilitar PIX nas cobranças</label>
  {settings.pixEnabled&&<div className="form-grid">
   <label className="field"><span>Tipo de chave</span><select value={settings.pixKeyType} disabled={!canConfigure} onChange={e=>setSettings({...settings,pixKeyType:e.target.value as PixKeyType})}><option value="">Selecione</option>{PIX_KEY_TYPES.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}</select></label>
   <label className="field"><span>Chave PIX</span><input value={settings.pixKey} disabled={!canConfigure} onChange={e=>setSettings({...settings,pixKey:e.target.value})}/></label>
   <label className="field"><span>Nome do titular</span><input value={settings.pixHolderName} disabled={!canConfigure} onChange={e=>setSettings({...settings,pixHolderName:e.target.value})}/></label>
  </div>}

  <div className="card-title" style={{marginTop:'var(--space-3)'}}><div><h3>Transferência bancária</h3><p>Opcional.</p></div></div>
  <label><input type="checkbox" checked={settings.bankTransferEnabled} disabled={!canConfigure} onChange={e=>setSettings({...settings,bankTransferEnabled:e.target.checked})}/> Habilitar transferência bancária</label>
  {settings.bankTransferEnabled&&<div className="form-grid">
   <label className="field"><span>Banco</span><input value={settings.bankName} disabled={!canConfigure} onChange={e=>setSettings({...settings,bankName:e.target.value})}/></label>
   <label className="field"><span>Agência</span><input value={settings.bankAgency} disabled={!canConfigure} onChange={e=>setSettings({...settings,bankAgency:e.target.value})}/></label>
   <label className="field"><span>Conta</span><input value={settings.bankAccount} disabled={!canConfigure} onChange={e=>setSettings({...settings,bankAccount:e.target.value})}/></label>
   <label className="field"><span>Titular</span><input value={settings.bankAccountHolder} disabled={!canConfigure} onChange={e=>setSettings({...settings,bankAccountHolder:e.target.value})}/></label>
  </div>}

  <div className="card-title" style={{marginTop:'var(--space-3)'}}><div><h3>Link de pagamento</h3><p>Opcional.</p></div></div>
  <label><input type="checkbox" checked={settings.paymentLinkEnabled} disabled={!canConfigure} onChange={e=>setSettings({...settings,paymentLinkEnabled:e.target.checked})}/> Habilitar link de pagamento</label>
  {settings.paymentLinkEnabled&&<label className="field"><span>Endereço do link</span><input value={settings.paymentLinkUrl} disabled={!canConfigure} onChange={e=>setSettings({...settings,paymentLinkUrl:e.target.value})}/></label>}

  <div className="card-title" style={{marginTop:'var(--space-3)'}}><div><h3>Contato e observações</h3></div></div>
  <div className="form-grid">
   <label className="field"><span>Telefone de suporte</span><input value={settings.supportPhone} disabled={!canConfigure} onChange={e=>setSettings({...settings,supportPhone:e.target.value})}/></label>
   <label className="field"><span>E-mail de suporte</span><input value={settings.supportEmail} disabled={!canConfigure} onChange={e=>setSettings({...settings,supportEmail:e.target.value})}/></label>
   <label className="field"><span>Texto de multa/juros por atraso</span><input value={settings.lateFeeText} disabled={!canConfigure} onChange={e=>setSettings({...settings,lateFeeText:e.target.value})}/></label>
   <label className="field"><span>Rodapé da mensagem</span><input value={settings.footerText} disabled={!canConfigure} onChange={e=>setSettings({...settings,footerText:e.target.value})}/></label>
  </div>

  {canConfigure&&<PrimaryButton loading={saving} onClick={save} style={{marginTop:'var(--space-3)'}}>Salvar configurações de cobrança</PrimaryButton>}
 </div>
}

function TemplateEditor({template,onClose,onSaved}:{template:CollectionMessageTemplate|null;onClose:()=>void;onSaved:()=>void}){
 const toast=useToast()
 const[input,setInput]=useState<CollectionTemplateInput>(template?{name:template.name,key:template.key,channel:template.channel,subject:template.subject,body:template.body,active:template.active}:EMPTY_TEMPLATE)
 const[saving,setSaving]=useState(false)
 const[preview,setPreview]=useState<{subject:string;body:string;invalidVariables:string[]}|null>(null)
 const[previewing,setPreviewing]=useState(false)
 const save=async()=>{
  setSaving(true)
  try{
   if(template)await updateCollectionMessageTemplate(template.id,input);else await createCollectionMessageTemplate(input)
   toast.push('Template salvo.',{tone:'success'})
   onSaved();onClose()
  }catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível salvar o template.',{tone:'error'})}
  finally{setSaving(false)}
 }
 const runPreview=async()=>{
  if(!template){toast.push('Salve o template antes de pré-visualizar.',{tone:'info'});return}
  setPreviewing(true)
  try{setPreview(await previewCollectionTemplate(template.id))}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível pré-visualizar.',{tone:'error'})}
  finally{setPreviewing(false)}
 }
 return<div className="card" style={{marginBottom:'var(--space-3)'}}>
  <div className="form-grid">
   <label className="field"><span>Nome</span><input value={input.name} onChange={e=>setInput({...input,name:e.target.value})}/></label>
   <label className="field"><span>Chave (identificador interno)</span><input value={input.key} onChange={e=>setInput({...input,key:e.target.value})}/></label>
   <label className="field"><span>Canal</span><select value={input.channel} onChange={e=>setInput({...input,channel:e.target.value as CollectionMessageChannel})}>{CHANNELS.map(c=><option value={c.value} key={c.value}>{c.label}</option>)}</select></label>
   <label className="field"><span>Assunto (e-mail)</span><input value={input.subject} onChange={e=>setInput({...input,subject:e.target.value})}/></label>
  </div>
  <label className="field"><span>Mensagem</span><textarea rows={8} value={input.body} onChange={e=>setInput({...input,body:e.target.value})}/></label>
  <p className="collections-template-variables">Variáveis disponíveis: {VARIABLES.map(v=>`{{${v}}}`).join(' ')}</p>
  <label><input type="checkbox" checked={input.active} onChange={e=>setInput({...input,active:e.target.checked})}/> Ativo</label>
  <div style={{display:'flex',gap:'var(--space-2)',marginTop:'var(--space-3)',flexWrap:'wrap'}}>
   <PrimaryButton loading={saving} onClick={()=>void save()}>Salvar template</PrimaryButton>
   <SecondaryButton loading={previewing} onClick={()=>void runPreview()}>Pré-visualizar</SecondaryButton>
   <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
  </div>
  {preview&&<div className="notice" style={{marginTop:'var(--space-3)'}}>
   {preview.invalidVariables.length>0&&<p role="alert">Variáveis inválidas encontradas: {preview.invalidVariables.map(v=>`{{${v}}}`).join(', ')}</p>}
   <p><strong>Assunto:</strong> {preview.subject}</p>
   <p style={{whiteSpace:'pre-wrap'}}>{preview.body}</p>
  </div>}
 </div>
}

function TemplatesSection(){
 const toast=useToast()
 const canConfigure=useHasPermission('collections.configure')
 const[templates,setTemplates]=useState<CollectionMessageTemplate[]>([])
 const[loading,setLoading]=useState(true)
 const[editing,setEditing]=useState<CollectionMessageTemplate|'new'|null>(null)
 const load=()=>fetchCollectionMessageTemplates().then(setTemplates).catch(()=>{}).finally(()=>setLoading(false))
 useEffect(()=>{load()},[])
 const seed=async()=>{
  try{setTemplates(await seedDefaultCollectionTemplates());toast.push('Templates padrão criados — edite livremente.',{tone:'success'})}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível criar os templates padrão.',{tone:'error'})}
 }
 const remove=async(id:string)=>{
  if(!confirm('Excluir este template?'))return
  try{await deleteCollectionMessageTemplate(id);void load();toast.push('Template excluído.',{tone:'success'})}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível excluir o template.',{tone:'error'})}
 }
 if(loading)return<div className="card"><p>Carregando…</p></div>
 return<div className="card">
  <div className="card-title"><div><h3>Templates de mensagem</h3><p>Cada organização edita livremente — nenhum texto é fixo por segmento.</p></div>
   {canConfigure&&templates.length===0&&<SecondaryButton onClick={()=>void seed()}>CRIAR TEMPLATES PADRÃO</SecondaryButton>}
  </div>
  {templates.length===0&&<p>Nenhum template configurado ainda.</p>}
  <ul className="team-list">
   {templates.map(t=><li key={t.id} className="team-row">
    <div><strong>{t.name}</strong><small> · {t.key} · {t.channel} {!t.active&&'· INATIVO'}</small></div>
    {canConfigure&&<div style={{display:'flex',gap:'var(--space-2)'}}><SecondaryButton onClick={()=>setEditing(t)}>EDITAR</SecondaryButton><SecondaryButton onClick={()=>void remove(t.id)}>EXCLUIR</SecondaryButton></div>}
   </li>)}
  </ul>
  {canConfigure&&editing==='new'&&<TemplateEditor template={null} onClose={()=>setEditing(null)} onSaved={load}/>}
  {canConfigure&&editing&&editing!=='new'&&<TemplateEditor template={editing} onClose={()=>setEditing(null)} onSaved={load}/>}
  {canConfigure&&!editing&&<SecondaryButton onClick={()=>setEditing('new')} style={{marginTop:'var(--space-3)'}}>NOVO TEMPLATE</SecondaryButton>}
 </div>
}

/**
 * Configurações → Cobranças (Sprint de Limpeza). Core só entrega
 * Cobrança + Template + Variáveis + Communication Hub — tudo aqui é
 * configuração da organização, nunca lógica do produto.
 */
export function CollectionsSettingsPage(){
 return<div className="page">
  <SettingsTabs active="cobrancas"/>
  <PageHeader eyebrow="CONFIGURAÇÕES" title="Cobranças" description="Identidade, formas de pagamento e templates de mensagem usados na cobrança."/>
  <SettingsSection/>
  <TemplatesSection/>
 </div>
}
