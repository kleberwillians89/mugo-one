# Mugô One — Arquitetura

## Objetivo

Mugô One é uma plataforma SaaS multiempresa da Mugô para gestão de clientes, vendas, comunicação, automações, financeiro, fiscal e inteligência.

## Princípios

- Multiempresa desde a origem
- Isolamento de dados por organization_id
- Row Level Security obrigatória
- Mínimo privilégio
- LGPD e privacidade por design
- Integrações desacopladas por providers
- Nenhuma regra específica de um cliente no Core

## Core

- Autenticação
- Usuários
- Organizações
- Membros
- Papéis e permissões
- Auditoria
- Privacidade

## Módulos futuros

- Dashboard
- Clientes
- Produtos e serviços
- Vendas
- Pagamentos
- Cobranças
- Estoque
- Fiscal
- WhatsApp
- SMS
- E-mail
- Automações
- IA
- Área do cliente
- Relatórios

## Autenticação

Preparar suporte para:

- E-mail e senha
- Magic Link
- Google
- Microsoft
- Recuperação de senha
- MFA

## LGPD

A arquitetura deve prever:

- termos versionados
- registro de aceite
- logs de auditoria
- solicitações do titular
- exportação de dados
- correção de dados
- exclusão conforme aplicável
- política de retenção
- isolamento entre organizações

## Multiempresa

Toda entidade operacional deverá pertencer a uma organização.

Exemplo:

organization_id

Um usuário poderá participar de uma ou mais organizações através de organization_members.

## Segurança

Nenhum dado de uma organização poderá ser acessado por membros de outra organização.

RLS será obrigatória nas tabelas multi-tenant.
