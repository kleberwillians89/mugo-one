import{useEffect,useRef,useState}from'react'
import{PageHeader,PrimaryButton,SecondaryButton,StatusBadge,useToast}from'../components/ui'
import{SettingsTabs}from'../components/SettingsTabs'
import{useHasPermission}from'../lib/PermissionsContext'
import{
 CollectionMessageTemplate,CollectionTemplateInput,EMPTY_COLLECTION_SETTINGS,OrganizationCollectionSettings,PixKeyType,
 duplicateCollectionMessageTemplate,fetchCollectionMessageTemplates,fetchOrganizationCollectionSettings,
 previewCollectionTemplate,restoreDefaultCollectionTemplate,saveOrganizationCollectionSettings,seedDefaultCollectionTemplates,
 setDefaultCollectionTemplate,updateCollectionMessageTemplate,
}from'../lib/collections'
import'./TeamSettingsPage.css'
import'./CollectionsSettingsPage.css'

const PIX_KEY_TYPES:{value:PixKeyType;label:string}[]=[{value:'cpf',label:'CPF'},{value:'cnpj',label:'CNPJ'},{value:'email',label:'E-mail'},{value:'telefone',label:'Telefone'},{value:'aleatoria',label:'Aleatória'}]
const VARIABLE_GROUPS:{group:string;items:{label:string;variable:string}[]}[]=[
 {group:'Cliente',items:[{label:'Nome',variable:'customer.name'}]},
 {group:'Cobrança',items:[{label:'Valor',variable:'collection.amount'},{label:'Vencimento',variable:'collection.due_date'}]},
 {group:'Empresa',items:[{label:'Nome da empresa',variable:'organization.name'}]},
 {group:'Pagamento',items:[{label:'Instruções de pagamento',variable:'payment.instructions'},{label:'Chave PIX',variable:'payment.pix_key'},{label:'Link de pagamento',variable:'payment.payment_link'}]},
 {group:'Suporte',items:[{label:'Telefone',variable:'support.phone'},{label:'E-mail',variable:'support.email'}]},
]

function PaymentMethodCard({title,enabled,summary,onToggle,editing,onEditToggle,canConfigure,children}:{
 title:string;enabled:boolean;summary:string|null;onToggle:(value:boolean)=>void;editing:boolean;onEditToggle:()=>void;canConfigure:boolean;children:React.ReactNode
}){
 return<div className="payment-method-card">
  <div className="payment-method-head">
   <div><strong>{title}</strong><StatusBadge tone={enabled?'success':'neutral'}>{enabled?'ATIVADO':'DESATIVADO'}</StatusBadge></div>
   {canConfigure&&<SecondaryButton onClick={onEditToggle}>{editing?'Fechar':enabled?'Editar':'Configurar'}</SecondaryButton>}
  </div>
  {!editing&&enabled&&summary&&<p className="payment-method-summary">{summary}</p>}
  {editing&&<div className="payment-method-body">
   <label className="confirm-checkbox"><input type="checkbox" checked={enabled} disabled={!canConfigure} onChange={e=>onToggle(e.target.checked)}/> Habilitar {title.toLowerCase()}</label>
   {enabled&&children}
  </div>}
 </div>
}

function SettingsSection(){
 const toast=useToast()
 const canConfigure=useHasPermission('collections.configure')
 const[settings,setSettings]=useState<OrganizationCollectionSettings>(EMPTY_COLLECTION_SETTINGS)
 const[loading,setLoading]=useState(true)
 const[saving,setSaving]=useState(false)
 const[editingMethod,setEditingMethod]=useState<'pix'|'bank'|'link'|null>(null)
 const[advancedOpen,setAdvancedOpen]=useState(false)
 useEffect(()=>{fetchOrganizationCollectionSettings().then(s=>{if(s)setSettings(s)}).catch(()=>{}).finally(()=>setLoading(false))},[])
 const save=async()=>{
  setSaving(true)
  try{setSettings(await saveOrganizationCollectionSettings(settings));toast.push('Configurações salvas.',{tone:'success'})}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível salvar.',{tone:'error'})}
  finally{setSaving(false)}
 }
 if(loading)return<div className="card"><p>Carregando…</p></div>
 return<>
  <div className="card" style={{marginBottom:'var(--space-4)'}}>
   <div className="card-title"><div><h3>Formas de pagamento</h3><p>Nada aqui é obrigatório — ative o que fizer sentido para o seu negócio.</p></div></div>
   <PaymentMethodCard title="PIX" enabled={settings.pixEnabled} summary={settings.pixKey?`${settings.pixKey}${settings.pixHolderName?` (${settings.pixHolderName})`:''}`:null}
    onToggle={v=>setSettings({...settings,pixEnabled:v})} editing={editingMethod==='pix'} onEditToggle={()=>setEditingMethod(editingMethod==='pix'?null:'pix')} canConfigure={canConfigure}>
    <div className="form-grid">
     <label className="field"><span>Tipo de chave</span><select value={settings.pixKeyType} onChange={e=>setSettings({...settings,pixKeyType:e.target.value as PixKeyType})}><option value="">Selecione</option>{PIX_KEY_TYPES.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}</select></label>
     <label className="field"><span>Chave PIX</span><input value={settings.pixKey} onChange={e=>setSettings({...settings,pixKey:e.target.value})}/></label>
     <label className="field"><span>Nome do titular</span><input value={settings.pixHolderName} onChange={e=>setSettings({...settings,pixHolderName:e.target.value})}/></label>
    </div>
   </PaymentMethodCard>
   <PaymentMethodCard title="Transferência" enabled={settings.bankTransferEnabled} summary={settings.bankName?`${settings.bankName}${settings.bankAgency?` — agência ${settings.bankAgency}`:''}`:null}
    onToggle={v=>setSettings({...settings,bankTransferEnabled:v})} editing={editingMethod==='bank'} onEditToggle={()=>setEditingMethod(editingMethod==='bank'?null:'bank')} canConfigure={canConfigure}>
    <div className="form-grid">
     <label className="field"><span>Banco</span><input value={settings.bankName} onChange={e=>setSettings({...settings,bankName:e.target.value})}/></label>
     <label className="field"><span>Agência</span><input value={settings.bankAgency} onChange={e=>setSettings({...settings,bankAgency:e.target.value})}/></label>
     <label className="field"><span>Conta</span><input value={settings.bankAccount} onChange={e=>setSettings({...settings,bankAccount:e.target.value})}/></label>
     <label className="field"><span>Titular</span><input value={settings.bankAccountHolder} onChange={e=>setSettings({...settings,bankAccountHolder:e.target.value})}/></label>
    </div>
   </PaymentMethodCard>
   <PaymentMethodCard title="Link de pagamento" enabled={settings.paymentLinkEnabled} summary={settings.paymentLinkUrl||null}
    onToggle={v=>setSettings({...settings,paymentLinkEnabled:v})} editing={editingMethod==='link'} onEditToggle={()=>setEditingMethod(editingMethod==='link'?null:'link')} canConfigure={canConfigure}>
    <label className="field"><span>Endereço do link</span><input value={settings.paymentLinkUrl} onChange={e=>setSettings({...settings,paymentLinkUrl:e.target.value})}/></label>
   </PaymentMethodCard>
  </div>

  <div className="card" style={{marginBottom:'var(--space-4)'}}>
   <div className="card-title"><div><h3>Contato</h3></div></div>
   <div className="form-grid">
    <label className="field"><span>Telefone</span><input value={settings.supportPhone} disabled={!canConfigure} onChange={e=>setSettings({...settings,supportPhone:e.target.value})}/></label>
    <label className="field"><span>E-mail</span><input value={settings.supportEmail} disabled={!canConfigure} onChange={e=>setSettings({...settings,supportEmail:e.target.value})}/></label>
   </div>
  </div>

  <details className="card collections-advanced" open={advancedOpen} onToggle={e=>setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
   <summary>Configurações avançadas</summary>
   <div className="form-grid" style={{marginTop:'var(--space-3)'}}>
    <label className="field"><span>Nome exibido nas cobranças</span><input value={settings.displayName} disabled={!canConfigure} onChange={e=>setSettings({...settings,displayName:e.target.value})}/></label>
    <label className="field"><span>Prazo padrão para vencimento (dias)</span><input type="number" min={0} max={365} value={settings.defaultDueDays} disabled={!canConfigure} onChange={e=>setSettings({...settings,defaultDueDays:Number(e.target.value)||0})}/></label>
   </div>
   <label className="field"><span>Instruções de pagamento (texto livre — substitui o resumo automático de PIX/transferência/link)</span><textarea rows={2} value={settings.paymentInstructions} disabled={!canConfigure} onChange={e=>setSettings({...settings,paymentInstructions:e.target.value})}/></label>
   <div className="form-grid">
    <label className="field"><span>Texto de multa/juros por atraso</span><input value={settings.lateFeeText} disabled={!canConfigure} onChange={e=>setSettings({...settings,lateFeeText:e.target.value})}/></label>
    <label className="field"><span>Rodapé da mensagem</span><input value={settings.footerText} disabled={!canConfigure} onChange={e=>setSettings({...settings,footerText:e.target.value})}/></label>
   </div>
  </details>

  {canConfigure&&<PrimaryButton loading={saving} onClick={save} style={{marginTop:'var(--space-3)'}}>Salvar configurações</PrimaryButton>}
 </>
}

function firstLine(body:string){return body.split('\n').find(line=>line.trim())??''}

function TemplateEditor({template,onClose,onSaved}:{template:CollectionMessageTemplate;onClose:()=>void;onSaved:()=>void}){
 const toast=useToast()
 const[name,setName]=useState(template.name)
 const[body,setBody]=useState(template.body)
 const[subject,setSubject]=useState(template.subject)
 const[active,setActive]=useState(template.active)
 const[saving,setSaving]=useState(false)
 const[preview,setPreview]=useState<{subject:string;body:string;invalidVariables:string[]}|null>(null)
 const[previewing,setPreviewing]=useState(false)
 const bodyRef=useRef<HTMLTextAreaElement>(null)

 const insertVariable=(variable:string)=>{
  const el=bodyRef.current
  const token=`{{${variable}}}`
  if(!el){setBody(body+token);return}
  const start=el.selectionStart??body.length,end=el.selectionEnd??body.length
  const next=body.slice(0,start)+token+body.slice(end)
  setBody(next)
  requestAnimationFrame(()=>{el.focus();el.selectionStart=el.selectionEnd=start+token.length})
 }

 const save=async()=>{
  setSaving(true)
  try{
   const input:CollectionTemplateInput={name,key:template.key,channel:template.channel,subject,body,active}
   await updateCollectionMessageTemplate(template.id,input)
   toast.push('Template salvo.',{tone:'success'})
   onSaved();onClose()
  }catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível salvar o template.',{tone:'error'})}
  finally{setSaving(false)}
 }
 const runPreview=async()=>{
  setPreviewing(true)
  try{setPreview(await previewCollectionTemplate(template.id))}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível pré-visualizar.',{tone:'error'})}
  finally{setPreviewing(false)}
 }

 return<div className="template-editor">
  <div className="template-editor-form">
   <label className="field"><span>Nome</span><input value={name} onChange={e=>setName(e.target.value)}/></label>
   <label className="field"><span>Assunto (e-mail)</span><input value={subject} onChange={e=>setSubject(e.target.value)}/></label>
   <label className="field"><span>Mensagem</span><textarea ref={bodyRef} rows={12} value={body} onChange={e=>setBody(e.target.value)}/></label>
   <div className="template-variables">
    <span>Variáveis disponíveis</span>
    {VARIABLE_GROUPS.map(g=><div className="template-variable-group" key={g.group}>
     <small>{g.group}</small>
     <div>{g.items.map(item=><button type="button" key={item.variable} onClick={()=>insertVariable(item.variable)}>+ {item.label}</button>)}</div>
    </div>)}
   </div>
   <label className="confirm-checkbox"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Ativo</label>
   <div className="template-editor-actions">
    <PrimaryButton loading={saving} onClick={()=>void save()}>Salvar</PrimaryButton>
    <SecondaryButton loading={previewing} onClick={()=>void runPreview()}>Pré-visualizar</SecondaryButton>
    <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
   </div>
  </div>
  <div className="template-editor-preview">
   <span>Prévia</span>
   {!preview&&<p className="template-preview-empty">Clique em Pré-visualizar para ver como esta mensagem chega com dados de exemplo.</p>}
   {preview&&<>
    {preview.invalidVariables.length>0&&<p className="template-preview-invalid" role="alert">Variável não reconhecida: {preview.invalidVariables.map(v=>`{{${v}}}`).join(', ')}</p>}
    <p className="template-preview-subject">{preview.subject}</p>
    <p className="template-preview-body">{preview.body}</p>
   </>}
  </div>
 </div>
}

function TemplateCard({template,onUse,onEdit,onDuplicate,onRestore,onToggleActive}:{
 template:CollectionMessageTemplate;onUse:()=>void;onEdit:()=>void;onDuplicate:()=>void;onRestore:()=>void;onToggleActive:()=>void
}){
 const[menuOpen,setMenuOpen]=useState(false)
 return<article className={`template-card${template.active?'':' template-card--inactive'}`}>
  <header>
   <div><strong>{template.name}</strong>{template.isDefault&&<StatusBadge tone="success">PADRÃO</StatusBadge>}{!template.active&&<StatusBadge tone="neutral">INATIVO</StatusBadge>}</div>
   <div className="template-card-menu">
    <button type="button" className="template-card-menu-trigger" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Mais opções">⋯</button>
    {menuOpen&&<div className="template-card-menu-list" onMouseLeave={()=>setMenuOpen(false)}>
     <button type="button" onClick={()=>{onDuplicate();setMenuOpen(false)}}>Duplicar</button>
     <button type="button" onClick={()=>{onRestore();setMenuOpen(false)}}>Restaurar padrão</button>
     <button type="button" onClick={()=>{onToggleActive();setMenuOpen(false)}}>{template.active?'Desativar':'Ativar'}</button>
    </div>}
   </div>
  </header>
  <p className="template-card-preview">{firstLine(template.body)}</p>
  <footer>
   {!template.isDefault&&<SecondaryButton onClick={onUse}>Usar como padrão</SecondaryButton>}
   <PrimaryButton onClick={onEdit}>Editar</PrimaryButton>
  </footer>
 </article>
}

function TemplatesSection(){
 const toast=useToast()
 const canConfigure=useHasPermission('collections.configure')
 const[templates,setTemplates]=useState<CollectionMessageTemplate[]>([])
 const[loading,setLoading]=useState(true)
 const[editingId,setEditingId]=useState<string|null>(null)
 const load=()=>fetchCollectionMessageTemplates().then(setTemplates).catch(()=>{}).finally(()=>setLoading(false))
 useEffect(()=>{load()},[])
 const seed=async()=>{
  try{setTemplates(await seedDefaultCollectionTemplates());toast.push('Templates padrão criados — edite livremente.',{tone:'success'})}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível criar os templates padrão.',{tone:'error'})}
 }
 const applyAsDefault=async(id:string)=>{
  try{await setDefaultCollectionTemplate(id);await load();toast.push('Template padrão atualizado.',{tone:'success'})}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível definir o padrão.',{tone:'error'})}
 }
 const duplicate=async(t:CollectionMessageTemplate)=>{
  try{await duplicateCollectionMessageTemplate(t);await load();toast.push('Template duplicado.',{tone:'success'})}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível duplicar.',{tone:'error'})}
 }
 const restore=async(id:string)=>{
  try{await restoreDefaultCollectionTemplate(id);await load();toast.push('Template restaurado ao padrão de fábrica.',{tone:'success'})}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível restaurar.',{tone:'error'})}
 }
 const toggleActive=async(t:CollectionMessageTemplate)=>{
  try{await updateCollectionMessageTemplate(t.id,{name:t.name,key:t.key,channel:t.channel,subject:t.subject,body:t.body,active:!t.active});await load()}
  catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível atualizar.',{tone:'error'})}
 }

 const editing=templates.find(t=>t.id===editingId)
 if(loading)return<div className="card"><p>Carregando…</p></div>
 return<div className="card">
  <div className="card-title"><div><h3>Mensagens</h3><p>Prontas para usar — edite o que quiser, quando quiser.</p></div>
   {canConfigure&&templates.length===0&&<SecondaryButton onClick={()=>void seed()}>CRIAR MENSAGENS PADRÃO</SecondaryButton>}
  </div>
  {editing
   ?<TemplateEditor template={editing} onClose={()=>setEditingId(null)} onSaved={load}/>
   :<div className="template-gallery">
     {templates.map(t=><TemplateCard key={t.id} template={t}
      onUse={()=>void applyAsDefault(t.id)} onEdit={()=>setEditingId(t.id)}
      onDuplicate={()=>void duplicate(t)} onRestore={()=>void restore(t.id)} onToggleActive={()=>void toggleActive(t)}/>)}
    </div>}
 </div>
}

/**
 * Configurações → Cobranças. Core só entrega Cobrança + Template +
 * Variáveis + Communication Hub — tudo aqui é configuração da
 * organização, nunca lógica do produto (briefing "CRITÉRIO FINAL").
 */
export function CollectionsSettingsPage(){
 return<div className="page">
  <SettingsTabs active="cobrancas"/>
  <PageHeader eyebrow="CONFIGURAÇÕES" title="Cobranças" description="Gerencie como sua empresa recebe e envia lembretes."/>
  <SettingsSection/>
  <TemplatesSection/>
 </div>
}
