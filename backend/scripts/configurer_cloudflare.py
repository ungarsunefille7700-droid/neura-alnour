"""Configure Cloudflare Workers AI for Neura Al Noor in one step.

    python scripts/configurer_cloudflare.py

Asks for the Account ID and the API token (the token is typed hidden), writes
them into backend/.env (never committed), checks that the token works with one
tiny request (~1 Neuron), then offers to run the model benchmark.
Nothing is sent anywhere except to Cloudflare.
"""
import asyncio
import getpass
import subprocess
import sys
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from neura_inference import CloudflareProvider, ProviderError  # noqa: E402

ENV_FILE = BACKEND / ".env"
SETTINGS_ORDER = ["NEURA_INFERENCE_PROVIDER", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN",
                  "NEURA_ENGINE_MODEL", "NEURA_LEGACY_AI"]


def write_env(values: dict):
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    header = "# Neura engine (Cloudflare Workers AI, plan gratuit)"
    kept = [line for line in lines if line.split("=", 1)[0].strip() not in values and line.strip() != header]
    while kept and not kept[-1].strip():
        kept.pop()
    if kept:
        kept.append("")
    kept.append(header)
    kept += [f"{key}={values[key]}" for key in SETTINGS_ORDER if key in values]
    ENV_FILE.write_text("\n".join(kept) + "\n", encoding="utf-8")


async def check(account: str, token: str, model: str):
    provider = CloudflareProvider(account, token, model)
    return await provider.chat([{"role": "user", "content": "Réponds juste : salam"}], max_tokens=10, temperature=0)


def clean(value: str) -> str:
    """Drop spaces, line breaks and invisible characters added by copy/paste (Ctrl+V can add an invisible control character)."""
    return "".join(ch for ch in (value or "") if ch.isprintable() and not ch.isspace())


def clipboard() -> str:
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-Clipboard"],
                             capture_output=True, text=True, timeout=10)
        return out.stdout
    except Exception:
        return ""


def cloudflare_errors(response) -> str:
    try:
        errors = response.json().get("errors") or []
        return "; ".join(f"{e.get('code')} {e.get('message')}" for e in errors) or response.text[:200]
    except Exception:
        return response.text[:200]


def verify_token(account: str, token: str) -> bool:
    """Ask Cloudflare whether the token is valid, without spending any Neuron."""
    headers = {"Authorization": f"Bearer {token}"}
    for url in ("https://api.cloudflare.com/client/v4/user/tokens/verify",
                f"https://api.cloudflare.com/client/v4/accounts/{account}/tokens/verify"):
        try:
            response = httpx.get(url, headers=headers, timeout=20)
        except httpx.HTTPError as exc:
            print(f"  Connexion à Cloudflare impossible ({type(exc).__name__}).")
            return False
        if response.status_code == 200 and (response.json().get("result") or {}).get("status") == "active":
            print("  Jeton reconnu et actif.")
            return True
        last = f"HTTP {response.status_code} : {cloudflare_errors(response)}"
    print(f"  Cloudflare ne reconnaît pas ce jeton ({last}).")
    return False


def main():
    print("=== Configuration de Cloudflare Workers AI pour Neura Al Noor ===\n")
    account = clean(input("Colle ton Account ID : "))
    if len(account) != 32:
        sys.exit(f"L'Account ID doit faire 32 caractères (reçu : {len(account)}). Rien n'a été modifié.")
    print("\nPour le jeton : copie-le dans Cloudflare (bouton Copy), puis appuie juste sur Entrée ici :")
    print("le programme le lira directement dans le presse-papiers (rien ne s'affiche).")
    token = clean(getpass.getpass("Entrée pour lire le presse-papiers (ou colle le jeton avec clic droit) : "))
    if not token:
        token = clean(clipboard())
    if not token:
        sys.exit("Aucun jeton trouvé (presse-papiers vide). Rien n'a été modifié.")
    print(f"Jeton reçu : {len(token)} caractères (un jeton Cloudflare en fait environ 40).")
    print("\n1) Vérification du jeton (gratuit)…")
    if not verify_token(account, token):
        sys.exit("Échec : recrée le jeton (modèle « Workers AI »), clique sur Copy, puis relance. Rien n'a été modifié.")
    model = "@cf/google/gemma-4-26b-a4b-it"
    print("2) Petite question à l'IA (≈ 1 Neuron)…")
    try:
        result = asyncio.run(check(account, token, model))
    except ProviderError as exc:
        detail = ""
        try:
            response = httpx.post(
                f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {token}"}, timeout=60,
                json={"model": model, "messages": [{"role": "user", "content": "salam"}], "max_tokens": 5})
            detail = f" (HTTP {response.status_code} : {cloudflare_errors(response)})"
        except Exception:
            pass
        hints = {
            "config": "Accès refusé à Workers AI : vérifie que l'Account ID est celui de la barre d'adresse.",
            "bad_request": "Requête refusée par Cloudflare.",
            "provider_quota": "Le quota gratuit du jour est déjà épuisé : réessaie après minuit UTC.",
        }
        sys.exit(f"Échec : {hints.get(exc.code, str(exc))}{detail} Rien n'a été modifié.")
    print(f"OK : Cloudflare répond (« {result.text.strip()[:40]} »), {result.neurons} Neuron(s) utilisé(s).")
    write_env({
        "NEURA_INFERENCE_PROVIDER": "cloudflare",
        "CLOUDFLARE_ACCOUNT_ID": account,
        "CLOUDFLARE_API_TOKEN": token,
        "NEURA_ENGINE_MODEL": model,
        "NEURA_LEGACY_AI": "on",
    })
    print(f"Enregistré dans {ENV_FILE} (ce fichier n'est jamais envoyé sur GitHub).")
    answer = input("\nLancer maintenant le banc d'essai des modèles (≈ 1 500 Neurons max, gratuit) ? [o/N] ")
    if answer.strip().lower() in ("o", "oui", "y", "yes"):
        env = dict(__import__("os").environ, CLOUDFLARE_ACCOUNT_ID=account, CLOUDFLARE_API_TOKEN=token)
        subprocess.run([sys.executable, str(BACKEND / "scripts" / "bench_cloudflare.py"), "--load", "10"], env=env)
    print("\nTerminé. Redémarre le backend local pour que l'app utilise Cloudflare.")


if __name__ == "__main__":
    main()
