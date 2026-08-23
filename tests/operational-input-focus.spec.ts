import {expect,test,type Locator,type Page} from '@playwright/test'

async function mount(page:Page){
  await page.goto('/login')
  await page.addScriptTag({type:'module',content:"import {mountModalFocusHarness} from '/tests/fixtures/modal-focus-harness.tsx'; mountModalFocusHarness();"})
  await expect(page.getByRole('dialog')).toBeVisible()
}

async function exercise(field:Locator,value:string){
  await field.focus()
  await field.pressSequentially(value,{delay:8})
  await expect(field).toBeFocused()
  await expect(field).toHaveValue(value)
  await field.press('Backspace')
  await expect(field).toHaveValue(value.slice(0,-1))
  await field.press(process.platform==='darwin'?'Meta+A':'Control+A')
  await field.pressSequentially('texto colado e editado')
  await expect(field).toHaveValue('texto colado e editado')
  await field.press('ArrowLeft')
  await field.press('Delete')
  await expect(field).toBeFocused()
}

test('convite e custódia mantêm foco durante digitação humana e rerender',async({page})=>{
  await mount(page)
  const email=page.getByLabel('E-mail do convite'),location=page.getByLabel('Caixa / localização')
  await exercise(email,'cliente.teste@ruah.com')
  await email.press('Tab')
  await expect(location).toBeFocused()
  await exercise(location,'Caixa Erica Prateleira 2')
  await page.getByRole('button',{name:'Rerender pai'}).click()
  await location.focus()
  await location.pressSequentially(' complemento')
  await expect(location).toBeFocused()
  await expect(location).toHaveValue(/complemento$/)
})
