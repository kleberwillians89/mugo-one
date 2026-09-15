begin;

-- Imagens de cobrança são privadas e entregues ao ManyChat por URL assinada
-- temporária. Não reutiliza buckets de importação, suporte ou comprovantes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('collection-images','collection-images',false,15728640,array['image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

commit;
