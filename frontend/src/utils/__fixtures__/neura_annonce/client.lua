-- client.lua – gestion de l’affichage NUI

RegisterNetEvent('neura_annonce:show')
AddEventHandler('neura_annonce:show', function(data)
    if not data or not data.text then return end

    -- Affiche l’annonce
    SendNUIMessage({
        type = 'show',
        text = data.text
    })

    -- Masque après 6 seconds
    SetTimeout(6000, function()
        SendNUIMessage({ type = 'hide' })
    end)
end)

-- Assure que le NUI ne prend jamais le focus du joueur
SetNuiFocus(false, false)
