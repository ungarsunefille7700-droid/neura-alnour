// script.js – réception des messages NUI et affichage

function show(text) {
    const el = document.getElementById('announcement');
    el.textContent = text;
    el.classList.add('visible');
}

function hide() {
    const el = document.getElementById('announcement');
    el.classList.remove('visible');
}

// Écoute les messages provenant du client Lua
window.addEventListener('message', function(event) {
    const data = event.data;
    if (!data || !data.type) return;

    if (data.type === 'show' && data.text) {
        show(data.text);
    } else if (data.type === 'hide') {
        hide();
    }
});
