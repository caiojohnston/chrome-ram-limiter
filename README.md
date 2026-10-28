# RAM Limiter for Chrome

Extensão que limita a memória usada pelo Chrome: quando ele passa do limite que você definiu,
ela suspende abas em segundo plano (as mais antigas primeiro) até voltar para baixo do limite.
O painel segue o visual das configurações do Chrome, com tema claro e escuro automáticos.
Abas suspensas continuam na barra e recarregam quando você clica nelas.

## Como funciona

- **`extension/`**: a extensão (painel, limite, suspensão automática a cada 30 s).
- **`host/`**: o medidor. Extensões do Chrome não conseguem ver quanta RAM o Chrome usa, então um
  programinha em C# (`host.cs`, sem janela) lê isso do Windows (mesmo número da coluna "Memória" do
  Gerenciador de Tarefas) e entrega para a extensão via *native messaging*, numa conexão única.

## Requisitos

Windows 10/11 e Google Chrome 121 ou mais novo. Nada mais para instalar: o medidor é compilado na hora
com o compilador C# que já vem no Windows.

## Instalação

1. Medidor (uma vez): `powershell -ExecutionPolicy Bypass -File instalar-medidor.ps1`
2. Extensão: abra `chrome://extensions`, ligue **Modo do desenvolvedor**, clique em
   **Carregar sem compactação** e escolha a pasta `extension`.

Se mover esta pasta de lugar, rode `instalar-medidor.ps1` de novo.

## Opções

| Opção | O que faz |
|---|---|
| Limite de RAM | Teto para o Chrome (1 a 16 GB). |
| Limite rígido | Ligado: passou do limite, suspende qualquer aba em segundo plano na hora. Desligado: só abas paradas há X minutos. |
| Medir por | RAM física (igual ao Gerenciador de Tarefas) ou memória comprometida (inclui o que foi para o arquivo de paginação). |
| Proteção do Windows | Também suspende abas quando o PC fica com pouca RAM livre (bom para jogar). |
| Proteger fixadas / com som | Nunca suspende abas fixadas ou tocando áudio. |
| Nunca suspender | Lista de sites protegidos (`web.whatsapp.com`, `youtube.com/watch`...). |

A aba ativa de cada janela nunca é suspensa. Atenção: texto digitado e não enviado numa aba suspensa se perde.

## Remover

1. Remova a extensão em `chrome://extensions`.
2. `powershell -ExecutionPolicy Bypass -File desinstalar-medidor.ps1`

O `manifest.json` traz uma chave pública que fixa o ID da extensão em `cbdlcpndhkmalkcbfchlkgodhmnhdigj`.
O medidor só aceita conversar com esse ID, então não mexa nesse campo.
