"""FiveM identification rules: given only for FiveM code requests, never as a blind
`owner = source` rule."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def message(content, project_context=None):
    return server.MessageCreate(content=content, project_context=project_context)


def test_fivem_request_gets_the_identification_rules():
    guard = server._code_delivery_guard(message("Crée un script FiveM de garage avec oxmysql"))
    assert guard.startswith(server.CODE_DELIVERY_GUARD)
    assert "ne l'enregistre JAMAIS en base" in guard
    assert "ESX.GetPlayerFromId(source).identifier" in guard
    assert "PlayerData.citizenid" in guard
    assert "GetPlayerIdentifierByType(source, 'license')" in guard
    assert "ne réécris pas un script qui fonctionne déjà" in guard


def test_fivem_detected_from_the_opened_project():
    guard = server._code_delivery_guard(message("Ajoute la vérification du propriétaire",
                                                "Fichier: neura_garage/fxmanifest.lua\nfx_version 'cerulean'"))
    assert server.FIVEM_CODE_GUARD in guard


def test_other_code_requests_are_unchanged():
    for text in ("Écris un module Python calc.py avec ses tests", "Crée un site web pour mon école",
                 "Ça a nui à mon projet, corrige le script JavaScript"):
        assert server._code_delivery_guard(message(text)) == server.CODE_DELIVERY_GUARD
