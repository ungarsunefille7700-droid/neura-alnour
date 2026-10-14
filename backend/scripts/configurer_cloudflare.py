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


def main():
    print("=== Configuration de Cloudflare Workers AI pour Neura Al Noor ===\n")
    account = input("Colle ton Account ID : ").strip()
    token = getpass.getpass("Colle ton jeton API (il reste invisible pendant la saisie) : ").strip()
    if not account or not token:
        sys.exit("Account ID ou jeton manquant : rien n'a été modifié.")
    model = "@cf/google/gemma-4-26b-a4b-it"
    print("\nVérification du jeton auprès de Cloudflare (≈ 1 Neuron)…")
    try:
        result = asyncio.run(check(account, token, model))
    except ProviderError as exc:
        hints = {
            "config": "Jeton refusé : recrée-le avec « Create a Workers AI API Token ».",
            "bad_request": "Requête refusée : vérifie l'Account ID.",
            "provider_quota": "Le quota gratuit du jour est déjà épuisé : réessaie après minuit UTC.",
        }
        sys.exit(f"Échec : {hints.get(exc.code, str(exc))} Rien n'a été modifié.")
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
