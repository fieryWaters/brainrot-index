// Options page: the address of the Brainrot Index server, also used as the website address.

const serverAddressInput = document.getElementById("server-address");

extensionApi.storage.local.get("serverAddress").then((stored) => {
  serverAddressInput.value = stored.serverAddress;
});

document.getElementById("options-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const serverAddress = serverAddressInput.value.replace(/\/+$/, "");
  await extensionApi.storage.local.set({ serverAddress: serverAddress });
  serverAddressInput.value = serverAddress;
  document.getElementById("save-status").textContent = "Saved";
});
