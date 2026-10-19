import { useEffect, useState } from "react";
import { Account, api, Instrument, Tag } from "./api";

// Accounts, instruments and tags used by filters and the manual entry form.
export function useReference() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loaded, setLoaded] = useState(false);

  function reloadTags() {
    api.listTags().then(setTags).catch(() => {});
  }

  useEffect(() => {
    Promise.all([api.listAccounts(), api.listInstruments(), api.listTags()])
      .then(([a, i, t]) => {
        setAccounts(a);
        setInstruments(i.filter((x) => x.active));
        setTags(t);
      })
      .finally(() => setLoaded(true));
  }, []);

  return { accounts, instruments, tags, loaded, reloadTags };
}
