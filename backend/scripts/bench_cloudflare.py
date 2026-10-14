"""Benchmark Cloudflare Workers AI models for Neura Al Noor (quality, speed, Neurons).

Run it yourself once your free Cloudflare account exists (no card needed):

    set CLOUDFLARE_ACCOUNT_ID=...      (PowerShell: $env:CLOUDFLARE_ACCOUNT_ID="...")
    set CLOUDFLARE_API_TOKEN=...
    python scripts/bench_cloudflare.py                     # compare the models
    python scripts/bench_cloudflare.py --load 10           # + 10 simultaneous requests
    python scripts/bench_cloudflare.py --max-neurons 800   # spend at most 800 Neurons

Safety: the script stops before spending more than --max-neurons (default 1500,
i.e. 15 % of the free daily 10,000). On the Workers Free plan Cloudflare refuses
requests beyond the free allocation instead of billing: nothing can be charged.
Results are written to bench_cloudflare_<date>.md next to this script; read the
answers to judge the quality of each language yourself.
"""
import argparse
import asyncio
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from neura_inference import CLOUDFLARE_TEXT_NEURONS, CloudflareProvider, ProviderError  # noqa: E402

MODELS = [
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/qwen/qwen3-30b-a3b-fp8",
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/zai-org/glm-4.7-flash",
    "@cf/openai/gpt-oss-20b",
]
SYSTEM = ("Tu es Neura Al Noor, un assistant musulman bienveillant. Réponds dans la langue et l'écriture "
          "du dernier message de l'utilisateur, en 3 à 5 phrases maximum.")
PROMPTS = [
    ("français", "Explique simplement comment faire les ablutions."),
    ("anglais", "What are the five pillars of Islam? Keep it short."),
    ("arabe", "ما هي فضائل صلاة الفجر؟"),
    ("darija (latin)", "Salam, kifach n9der nwlli nsalli f lw9t kol nhar?"),
    ("darija (arabe)", "واش ممكن تعطيني دعاء قبل النعاس؟"),
    ("tarifit", "Azul, mamec tettaraḥ ɣer lǧameɛ? Ini-yi-d s tmaziɣt n Arif."),
]


class Spend:
    def __init__(self, cap):
        self.cap, self.used = cap, 0.0

    def allow(self, worst):
        return self.used + worst <= self.cap


async def run_one(provider, model, prompt, spend):
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
    worst = provider.max_neurons(model, 200, 400)
    if not spend.allow(worst):
        return {"skipped": "limite de Neurons du test atteinte"}
    started = time.monotonic()
    first = None
    text = []
    result = None
    try:
        async for kind, value in provider.stream_chat(messages, model=model, max_tokens=400, temperature=0.4):
            if kind == "delta":
                first = first or time.monotonic()
                text.append(value)
            else:
                result = value
    except ProviderError as exc:
        return {"error": f"{exc.code}: {exc}"}
    spend.used += result.neurons
    return {
        "first_token_s": round((first or time.monotonic()) - started, 2),
        "total_s": round(time.monotonic() - started, 2),
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
        "neurons": result.neurons,
        "usage_reported": result.usage_reported,
        "answer": "".join(text).strip(),
    }


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="*", default=MODELS)
    parser.add_argument("--max-neurons", type=float, default=1500)
    parser.add_argument("--load", type=int, default=0, help="simultaneous requests for the load test")
    args = parser.parse_args()
    account, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not account or not token:
        sys.exit("Définis CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN (voir DEPLOIEMENT_CLOUDFLARE.md).")
    spend = Spend(args.max_neurons)
    lines = [f"# Banc d'essai Cloudflare Workers AI — {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC", ""]
    summary = []
    for model in args.models:
        provider = CloudflareProvider(account, token, model)
        lines += [f"## {model}", "", "| Langue | 1er mot | Total | Tokens (entrée/sortie) | Neurons |", "|---|---|---|---|---|"]
        details = []
        totals = []
        for language, prompt in PROMPTS:
            r = await run_one(provider, model, prompt, spend)
            print(model, language, {k: v for k, v in r.items() if k != "answer"}, flush=True)
            if "neurons" in r:
                totals.append(r)
                lines.append(f"| {language} | {r['first_token_s']} s | {r['total_s']} s | "
                             f"{r['prompt_tokens']}/{r['completion_tokens']} | {r['neurons']} |")
                details.append(f"**{language}** — {prompt}\n\n> " + r["answer"].replace("\n", "\n> ") + "\n")
            else:
                lines.append(f"| {language} | — | — | — | {r.get('error') or r.get('skipped')} |")
        if totals:
            avg = sum(t["neurons"] for t in totals) / len(totals)
            summary.append((model, avg, sum(t["total_s"] for t in totals) / len(totals)))
        lines += ["", *details, ""]

    if args.load and summary:
        model = args.models[0]  # the model the app will use (first in the list)
        provider = CloudflareProvider(account, token, model)
        worst = provider.max_neurons(model, 200, 150) * args.load
        if spend.allow(worst):
            async def one(i):
                t0 = time.monotonic()
                try:
                    res = await provider.chat([{"role": "system", "content": SYSTEM},
                                               {"role": "user", "content": f"Donne un conseil court n°{i} pour la prière."}],
                                              model=model, max_tokens=150, temperature=0.7)
                    return True, time.monotonic() - t0, res.neurons
                except ProviderError as exc:
                    return False, time.monotonic() - t0, 0.0
            t0 = time.monotonic()
            results = await asyncio.gather(*(one(i) for i in range(args.load)))
            spend.used += sum(r[2] for r in results)
            ok = [r[1] for r in results if r[0]]
            ok.sort()
            lines += [f"## Test de charge : {args.load} requêtes simultanées ({model})", "",
                      f"- réussies : {len(ok)}/{args.load}",
                      f"- durée totale : {time.monotonic() - t0:.1f} s",
                      f"- médiane : {ok[len(ok) // 2]:.1f} s, max : {ok[-1]:.1f} s" if ok else "- aucune réussite", ""]
        else:
            lines += ["## Test de charge non lancé : il dépasserait la limite de Neurons du test.", ""]

    lines += ["## Résumé", "", "| Modèle | Neurons moyens / réponse | Temps moyen | Réponses possibles / jour (9 000 Neurons) |",
              "|---|---|---|---|"]
    for model, avg, secs in sorted(summary, key=lambda s: s[1]):
        lines.append(f"| {model} | {avg:.1f} | {secs:.1f} s | ≈ {int(9000 / avg) if avg else '—'} (prompt court du test) |")
    lines += ["", f"Neurons dépensés par ce test : {spend.used:.0f} / {args.max_neurons:.0f}",
              "", "Tarifs Neurons par million de tokens utilisés : " +
              ", ".join(f"{m.split('/')[-1]} {CLOUDFLARE_TEXT_NEURONS[m][0]:.0f}/{CLOUDFLARE_TEXT_NEURONS[m][1]:.0f}"
                        for m in args.models if m in CLOUDFLARE_TEXT_NEURONS)]
    out = Path(__file__).with_name(f"bench_cloudflare_{datetime.now():%Y%m%d_%H%M}.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nRapport : {out}\nNeurons dépensés : {spend.used:.0f}")


if __name__ == "__main__":
    asyncio.run(main())
