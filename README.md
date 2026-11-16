# 🎄 Amigo Secreto da Família

Site simples onde cada pessoa cadastra os tamanhos de camisa, calça e sapato e o que quer ganhar. Todo mundo vê a lista. O sorteio pelo site é opcional.

## Como funciona

- **Senha da família** (4 números): primeiro passo para entrar no site.
- **Quem é você?**: depois da senha, a pessoa escolhe entre "Quero entrar na brincadeira" (cadastro com nome, PIN de 4 números e pelo menos uma dica) ou "Já estou na lista" (nome + PIN).
- **Lembra por 2 meses**: no mesmo navegador, a pessoa entra direto, sem senha nem PIN.
- **Meus dados**: a pessoa edita os próprios dados.
- **Ver quem eu tirei**: aparece depois do sorteio; o nome vem escondido e o olho mostra.
- **Organizador** (link no rodapé, PIN próprio, pedido toda vez):
  - define a data, o local e o valor do presente;
  - faz ou desfaz o sorteio;
  - remove um participante (nome repetido ou PIN esquecido: a pessoa se cadastra de novo). Remover desfaz o sorteio.
- **Sorteio**: uniforme e com aleatoriedade criptográfica; ninguém tira a si mesmo e ninguém é tirado duas vezes. Se a lista mudar depois do sorteio, sorteie de novo.
- **Proteção contra chute de PIN**: depois de 20 PINs errados, o IP fica bloqueado por 15 minutos.

## Privacidade

Quem só tem acesso ao banco (Upstash) não descobre o PIN de ninguém nem quem tirou quem:

- o PIN é guardado só como HMAC-SHA256 feito com o `SEGREDO`;
- o resultado do sorteio é cifrado com AES-256-GCM, com chave derivada do `SEGREDO`.

O `SEGREDO` fica só nas variáveis de ambiente da Vercel. Quem tiver o banco **e** o `SEGREDO` consegue abrir os dados. **Não troque o `SEGREDO` depois de usar o site**: os PINs param de funcionar e o sorteio fica ilegível.

## Colocar no ar (Vercel)

1. Crie um repositório no GitHub e envie esta pasta:
   ```bash
   git init
   git add .
   git commit -m "amigo secreto"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/amigo-secreto.git
   git push -u origin main
   ```
2. Na Vercel, clique em **Add New → Project**, importe o repositório e mantenha o Framework como **Other**. Depois clique em **Deploy**.
3. No projeto da Vercel, abra **Storage → Create Database → Upstash (Redis)**. Crie o banco no plano grátis e conecte-o ao projeto. As variáveis do banco são adicionadas sozinhas.
4. Abra **Settings → Environment Variables** e adicione:
   - `FAMILY_PIN`: a senha da família, com 4 números (ex.: `2512`)
   - `ADMIN_PIN`: o PIN do organizador, com 4 números (diferente do anterior)
   - `SEGREDO`: um texto aleatório longo. Gere com:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
     ```
     Marque como **Sensitive**. Guarde uma cópia em lugar seguro.
5. Abra **Deployments**, clique em **⋯** no último deploy e escolha **Redeploy**. As variáveis só passam a valer depois disso.
6. Mande o link e a senha da família no grupo 🎁

## Testar no computador

Copie `.env.example` para `.env` e preencha `FAMILY_PIN`, `ADMIN_PIN` e `SEGREDO` (o `.env` não vai para o Git).

```bash
npm run dev   # http://localhost:3004, senhas do .env (dados somem ao fechar)
npm test
```
