import { useEffect, useState } from "react";
import { Account, api, Instrument, Tag } from "./api";
import { useSegment } from "./segment";

// Accounts, instruments and tags used by filters and the manual entry form.
// Instruments are those of the current Futures / Options book unless allBooks is set
// (imports, which can contain either).
export function useReference({ allBooks = false }: { allBooks?: boolean } = {}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { segment } = useSegment();

  function reloadTags() {
    api.listTags().then(setTags).catch(() => {});
  }

  useEffect(() => {
    Promise.all([api.listAccounts(), api.listInstruments(), api.listTags()])
      .then(([a, i, t]) => {
        setAccounts(a);
        setInstruments(i.filter((x) => x.active && (allBooks || (x.segment ?? "futures") === segment)));
        setTags(t);
      })
      .finally(() => setLoaded(true));
  }, [segment]);

  return { accounts, instruments, tags, loaded, reloadTags };
}
