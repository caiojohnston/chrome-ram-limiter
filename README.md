# Limitador de RAM para Chrome

Extensão que limita a RAM do Chrome como o limitador do Opera GX: quando o Chrome passa do limite,
ela suspende abas em segundo plano (as mais antigas primeiro) até voltar para baixo do limite.
Abas suspensas continuam na barra e recarregam quando você clica nelas.

## Como funciona

- **`extension/`**: a extensão (painel, limite, suspensão automática a cada 30 s).
- **`host/`**: o medidor. Extensões do Chrome não conseguem ver quanta RAM o Chrome usa, então um
  script Python pequeno lê isso do Windows (mesmo número da coluna "Memória" do Gerenciador de Tarefas)
  e entrega para a extensão via *native messaging*.

## Requisitos

Windows 10/11, Google Chrome 121 ou mais novo e Python 3 instalado (só o medidor usa, sem bibliotecas extras).

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
