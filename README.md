# 🎄 Amigo Secreto da Família

Site simples onde cada pessoa cadastra os tamanhos de camisa, calça e sapato e o que quer ganhar. Todo mundo vê a lista. O sorteio pelo site é opcional.

## Como funciona

- **Entrada**: senha da família (4 números), depois cadastro com nome e PIN ou login de quem já está na lista. O navegador lembra a pessoa por 2 meses.
- **Lista**: cada pessoa edita os próprios dados e vê os dados de todos.
- **Ver quem eu tirei**: aparece depois do sorteio, com os dados do amigo escondidos até clicar no olho.
- **Organizador** (link no rodapé, PIN próprio): define data, local e valor do presente, faz ou desfaz o sorteio, gera sorteios teste e remove participantes.
- **Sorteio**: aleatoriedade criptográfica; ninguém tira a si mesmo nem é tirado duas vezes. Se a lista mudar, sorteie de novo.
- **Proteção**: depois de 20 PINs errados, o IP fica bloqueado por 15 minutos.

## Privacidade

Quem só tem acesso ao banco não descobre o PIN de ninguém nem quem tirou quem:

- o PIN é guardado como HMAC-SHA256 feito com o `SEGREDO`;
- o sorteio é cifrado com AES-256-GCM, com chave derivada do `SEGREDO`.

**Não troque o `SEGREDO` depois de usar o site**: os PINs param de funcionar e o sorteio fica ilegível.

## Rodar no computador

Copie `.env.example` para `.env` e preencha:

- `FAMILY_PIN`: senha da família, 4 números
- `ADMIN_PIN`: PIN do organizador, 4 números
- `SEGREDO`: texto aleatório longo, gerado com
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

```bash
npm run dev   # http://localhost:3004 (dados somem ao fechar)
npm test
```
