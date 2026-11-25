import { useEffect } from 'react'

const registrationUrl = 'https://tenx-account-console.ozeki-deploy.workers.dev/register?from=quotation'

export default function Register() {
  useEffect(() => {
    window.location.replace(registrationUrl)
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <a className="font-medium text-blue-700 underline" href={registrationUrl}>共通アカウントの新規登録を開く</a>
    </main>
  )
}
