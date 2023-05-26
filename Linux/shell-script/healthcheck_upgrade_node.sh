#!/bin/bash

list="$@"

for var in $list;
do
   echo "argument passed : ${var}"
   
   #split argument (name:version)
   varArr=(${var//:/ })
   pkgname=${varArr[0]}
   pkgversion=${varArr[1]}
   pkg=$pkgname"@"$pkgversion
   echo $pkg
   
   #find location of package
   globalList=$(find /usr/local/lib/node_modules/npm/node_modules -type d -name ${pkgname})
   echo $globalList
   echo ${#globalList}

   #check if location found
   if [ ${#globalList} -gt 1 ];
   then
        #download the package with fix version
        npm install $pkg

        #copy the fixed package to different location
        for path in $globalList;
        do
          dir=$path
          dir_strip="${path%/*}"
          echo "-------------------------"
          echo "remove dir : ${dir}"
          rm -rf $dir
          echo "-------------------------"
          echo "check dir after removal"
          ls $dir
          echo "-------------------------"
          echo "copy ${pkg} node module to dir : ${dir_strip}"
          cp -R node_modules/$pkgname $dir_strip
          echo "-------------------------"
          echo "check dir after copy : "
          ls -lrt $dir
        done
   else
        echo "${pkg} path not present!!"
   fi
done