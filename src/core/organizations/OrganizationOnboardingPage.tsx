import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../shared/lib/supabase'
import { useOrganization } from './useOrganization'

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function OrganizationOnboardingPage() {
  const {
    organizations,
    loading,
    refreshOrganizations,
  } = useOrganization()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return <div>Preparando sua conta...</div>
  }

  if (organizations.length > 0) {
    return <Navigate to="/" replace />
  }

  function handleNameChange(value: string) {
    setName(value)
    setSlug(slugify(value))
    setMessage('')
  }

  function handleSlugChange(value: string) {
    setSlug(slugify(value))
    setMessage('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const organizationName = name.trim()
    const organizationSlug = slugify(slug)

    setMessage('')

    if (organizationName.length < 2) {
      setMessage('Digite um nome válido para a empresa.')
      return
    }

    if (!organizationSlug) {
      setMessage('O identificador da empresa é obrigatório.')
      return
    }

    setSubmitting(true)

    try {
      const { error } = await supabase.rpc(
        'create_organization',
        {
          p_name: organizationName,
          p_slug: organizationSlug,
        },
      )

      if (error) {
        if (
          error.message.toLowerCase().includes('duplicate') ||
          error.message.toLowerCase().includes('unique')
        ) {
          setMessage(
            'Esse identificador já está sendo utilizado. Escolha outro.',
          )
          return
        }

        console.error(
          'Erro ao criar organização:',
          error,
        )

        setMessage(
          'Não foi possível criar sua empresa. Tente novamente.',
        )

        return
      }

      await refreshOrganizations()
    } catch (error) {
      console.error(
        'Erro inesperado ao criar organização:',
        error,
      )

      setMessage(
        'Ocorreu um erro inesperado. Tente novamente.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 480,
        }}
      >
        <p>MUGÔ ONE</p>

        <h1>Vamos configurar sua empresa.</h1>

        <p>
          Essa será sua primeira organização dentro do Mugô One.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Nome da empresa

            <input
              type="text"
              value={name}
              required
              minLength={2}
              autoComplete="organization"
              disabled={submitting}
              onChange={(event) =>
                handleNameChange(event.target.value)
              }
            />
          </label>

          <label>
            Identificador

            <input
              type="text"
              value={slug}
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              disabled={submitting}
              onChange={(event) =>
                handleSlugChange(event.target.value)
              }
            />
          </label>

          <p>
            Esse identificador será usado internamente para
            identificar sua empresa no Mugô One.
          </p>

          <button
            type="submit"
            disabled={
              submitting ||
              name.trim().length < 2 ||
              !slug.trim()
            }
          >
            {submitting
              ? 'Criando empresa...'
              : 'Criar minha empresa'}
          </button>
        </form>

        {message && (
          <p role="alert">
            {message}
          </p>
        )}
      </section>
    </main>
  )
}