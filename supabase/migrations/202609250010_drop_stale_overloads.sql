begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- Bug real achado ao vivo: adicionar p_causation_id como parâmetro
-- final em create_task/send_communication_message via CREATE OR
-- REPLACE não substitui a função antiga — Postgres trata uma lista de
-- parâmetros mais longa como uma ASSINATURA DIFERENTE (overload novo),
-- não uma substituição. Isso deixou 3 versões de create_task (8/9/10
-- args) e 2 de send_communication_message (12/13 args) coexistindo.
-- Qualquer chamada via supabase-js com argumentos nomeados que não
-- incluísse o novo parâmetro (ou seja, TODO o Task Engine da Sprint
-- K/L e o Communication Hub da Sprint N, já em produção) ficava
-- ambígua entre overloads — "function is not unique" — quebrando
-- funcionalidade já existente, não só a nova. Removidas as versões
-- antigas; só a assinatura mais recente de cada uma continua.
-- ============================================================

drop function if exists public.create_task(uuid, text, text, text, uuid, timestamptz, text, uuid);
drop function if exists public.create_task(uuid, text, text, text, uuid, timestamptz, text, uuid, jsonb);
drop function if exists public.send_communication_message(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text);

commit;
