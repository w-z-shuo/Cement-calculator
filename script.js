function parseNumberList(input){
  return input
    .split(/[,\n\s]+/)
    .map(s=>s.trim())
    .filter(Boolean)
    .map(v=>Number(v))
    .filter(v=>Number.isFinite(v)&&v>0);
}

function floorToBags(kg, bagKg){
  return Math.floor(kg / bagKg);
}

function formatTons(kg){
  return (kg/1000).toFixed(3).replace(/\.0+$/,'');
}

function allocateBagsToPallets({ totalTons, bagWeightKg, palletWeightKg, palletDynamicLoadTon, initialFillPercent, enableRedistribution }){
  const totalCementKg = totalTons * 1000;
  const bagKg = bagWeightKg;
  const totalBags = Math.ceil(totalCementKg / bagKg);

  const dynamicKg = palletDynamicLoadTon * 1000;
  const initialCapKg = dynamicKg * (initialFillPercent/100);
  const maxCargoKg = Math.max(0, initialCapKg - palletWeightKg);
  const maxBagsPerPallet = Math.max(0, floorToBags(maxCargoKg, bagKg));

  if(maxBagsPerPallet<=0){
    return { pallets: [], remainingCementBags: totalBags };
  }

  const fullPalletsCount = Math.floor(totalBags / maxBagsPerPallet);
  let remainderBags = totalBags - fullPalletsCount * maxBagsPerPallet;

  const pallets = [];
  for(let i=0;i<fullPalletsCount;i++){
    pallets.push({ index: i+1, dynamicKg, maxBags: maxBagsPerPallet, bags: maxBagsPerPallet });
  }
  if(remainderBags>0){
    pallets.push({ index: pallets.length+1, dynamicKg, maxBags: maxBagsPerPallet, bags: remainderBags });
  }

  if(enableRedistribution && remainderBags>0 && fullPalletsCount>0){
    const perPallet = Math.ceil(remainderBags / fullPalletsCount);
    if(perPallet < 3){
      const absoluteMaxBags = floorToBags(Math.max(0, dynamicKg - palletWeightKg), bagKg);
      const extraHeadroomPerFull = Math.max(0, absoluteMaxBags - maxBagsPerPallet);
      if(extraHeadroomPerFull>0){
        const movable = Math.min(remainderBags, extraHeadroomPerFull * fullPalletsCount);
        let moved = 0;
        for(let i=0;i<fullPalletsCount;i++){
          if(moved>=movable) break;
          const give = Math.min(perPallet, movable - moved, extraHeadroomPerFull);
          pallets[i].bags += give;
          moved += give;
        }
        remainderBags -= moved;
        const lastIdx = pallets.length-1;
        if(remainderBags===0 && pallets[lastIdx] && pallets[lastIdx].bags < maxBagsPerPallet){
          pallets.pop();
        } else if(pallets[lastIdx] && remainderBags<movable){
          pallets[lastIdx].bags = Math.max(0, pallets[lastIdx].bags - (movable - remainderBags));
          if(pallets[lastIdx].bags===0) pallets.pop();
        }
      }
    }
  }

  return { pallets, remainingCementBags: 0 };
}

function assignPalletsToTrucks({ pallets, palletWeightKg, bagWeightKg, truckCapTon }){
  const trucks = [];
  // Sort pallets by weight descending for FFD
  const palletItems = pallets.map(p=>{
    const weightKg = p.bags*bagWeightKg + palletWeightKg;
    return { ...p, weightKg };
  }).sort((a,b)=>b.weightKg - a.weightKg);

  for(const item of palletItems){
    let placed = false;
    for(const truck of trucks){
      if(truck.usedKg + item.weightKg <= truck.capKg){
        truck.pallets.push(item);
        truck.usedKg += item.weightKg;
        placed = true;
        break;
      }
    }
    if(!placed){
      const newIndex = trucks.length + 1;
      const newTruck = { index: newIndex, capKg: truckCapTon*1000, pallets: [item], usedKg: item.weightKg };
      trucks.push(newTruck);
    }
  }

  return trucks;
}

function renderResults({ pallets, trucks, bagWeightKg, palletWeightKg, totalTons, remainingBags }){
  const el = document.getElementById('results');
  const totalBags = pallets.reduce((s,p)=>s+p.bags,0);
  const totalKg = totalBags*bagWeightKg;
  const totalPallets = pallets.length;
  const trucksUsed = trucks.length;

  let html = '';
  html += `<div class="tag">总袋数：${totalBags} 袋</div>`;
  html += `<div class="tag">总托盘：${totalPallets} 个</div>`;
  html += `<div class="tag">车辆数：${trucksUsed} 辆</div>`;
  if(remainingBags>0){
    html += `<div class="tag warn">未装袋数：${remainingBags} 袋</div>`;
  }

  trucks.forEach(truck=>{
    const capKg = truck.capKg;
    const usedKg = truck.usedKg;
    const remainKg = capKg - usedKg;
    html += `<div class="truck"><div><strong>车辆 #${truck.index}</strong> （已用 ${formatTons(usedKg)} 吨 / 容量 ${formatTons(capKg)} 吨，剩余 ${formatTons(remainKg)} 吨）</div>`;
    html += `<div class="pallets">`;
    truck.pallets.forEach(p=>{
      const wKg = p.bags*bagWeightKg + palletWeightKg;
      html += `<div class="pallet">托盘 #${p.index}<br>袋数：${p.bags} 袋<br>重量：${formatTons(wKg)} 吨</div>`;
    });
    html += `</div></div>`;
  });

  el.innerHTML = html;
}

function onSubmit(evt){
  evt.preventDefault();
  const totalTons = Number(document.getElementById('totalTons').value);
  const bagWeightKg = Number(document.getElementById('bagWeightKg').value);
  const palletWeightKg = Number(document.getElementById('palletWeightKg').value);
  const palletDynamicLoadTon = Number(document.getElementById('palletDynamicLoad').value);
  const truckCapTon = Number(document.getElementById('truckCapacity').value);
  const initialFillPercent = Number(document.getElementById('initialFillPercent').value || 90);
  const enableRedistribution = document.getElementById('enableRedistribution').checked;

  if(!(totalTons>0 && bagWeightKg>0 && palletWeightKg>=0 && palletDynamicLoadTon>0 && truckCapTon>0)){
    alert('请输入有效数据');
    return;
  }

  const allocation = allocateBagsToPallets({ totalTons, bagWeightKg, palletWeightKg, palletDynamicLoadTon, initialFillPercent, enableRedistribution });
  const trucks = assignPalletsToTrucks({ pallets: allocation.pallets, palletWeightKg, bagWeightKg, truckCapTon });
  renderResults({ pallets: allocation.pallets, trucks, bagWeightKg, palletWeightKg, totalTons, remainingBags: allocation.remainingCementBags });
}

function fillDemo(){
  document.getElementById('totalTons').value = 48;
  document.getElementById('bagWeightKg').value = 50;
  document.getElementById('palletWeightKg').value = 25;
  document.getElementById('palletDynamicLoad').value = '1.5';
  document.getElementById('truckCapacity').value = '10';
  document.getElementById('initialFillPercent').value = 90;
  document.getElementById('enableRedistribution').checked = true;
}

document.getElementById('calc-form').addEventListener('submit', onSubmit);
document.getElementById('fillDemo').addEventListener('click', fillDemo);


