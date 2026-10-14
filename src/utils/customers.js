const STORAGE_KEY = "stitch-desk.customers";

export function getCustomerProfiles() {
  try {
    const storedProfiles = localStorage.getItem(STORAGE_KEY);
    if (storedProfiles === null) {
      return [];
    }

    const profiles = JSON.parse(storedProfiles);
    if (!Array.isArray(profiles)) {
      throw new Error("Saved customer data has an invalid format.");
    }
    return profiles;
  } catch (error) {
    throw new Error(`Unable to load customer details: ${error.message}`);
  }
}

export function saveCustomerProfile(profile) {
  try {
    const profiles = getCustomerProfiles();
    const savedProfiles = [
      ...profiles.filter((saved) => saved.key !== profile.key),
      profile,
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedProfiles));
    return profile;
  } catch (error) {
    throw new Error(`Unable to save customer details: ${error.message}`);
  }
}
