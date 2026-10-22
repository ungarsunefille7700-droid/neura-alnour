-- server.lua – commande /annonce avec vérification ACE

RegisterCommand('annonce', function(source, args, rawCommand)
    local src = source

    -- Vérifie la permission ACE
    if not IsPlayerAceAllowed(src, 'neura.annonce') then
        TriggerClientEvent('chat:addMessage', src, {
            args = { '^1Erreur', 'Vous n\'avez pas la permission d\'utiliser cette commande.' }
        })
        return
    end

    -- Concatène le texte fourni
    local text = table.concat(args, ' ')

    -- Validation du texte
    if text == '' then
        TriggerClientEvent('chat:addMessage', src, {
            args = { '^1Erreur', 'Le texte de l\'annonce ne peut pas être vide.' }
        })
        return
    end

    if #text > 200 then
        TriggerClientEvent('chat:addMessage', src, {
            args = { '^1Erreur', 'Le texte de l\'annonce ne doit pas dépasser 200 caractères.' }
        })
        return
    end

    -- Diffuse l’annonce à tous les joueurs
    TriggerClientEvent('neura_annonce:show', -1, { text = text })
end, false)
